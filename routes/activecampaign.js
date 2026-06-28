const express  = require('express');
const router   = express.Router();
const fetch    = require('node-fetch');
const supabase = require('../database');

const CACHE_KEY  = 'activecampaign_metrics';
const CACHE_TTL  = parseInt(process.env.AC_CACHE_MINUTES || '180', 10) * 60 * 1000;
const UA         = 'Mozilla/5.0 MetricDashboard/1.0';   // AC's Cloudflare edge blocks empty UAs
const THROTTLE_MS = Math.max(0, parseInt(process.env.AC_THROTTLE_MS || '250', 10)); // AC limit ~5 req/s
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getCreds() {
  const { data } = await supabase.from('settings').select('key, value').in('key', ['ac_api_url', 'ac_api_token']);
  const s = Object.fromEntries((data || []).map(r => [r.key, r.value]));
  return {
    url:   (s.ac_api_url || process.env.AC_API_URL || '').replace(/\/+$/, ''),
    token: s.ac_api_token || process.env.AC_API_TOKEN || '',
  };
}

async function acFetch(base, token, path, attempts = 5) {
  const url = path.startsWith('http') ? path : `${base}/api/3/${path}`;
  let lastErr, tries = 0, rate = 0;
  while (tries < attempts) {
    try {
      const resp = await fetch(url, { timeout: 45000, headers: { 'Api-Token': token, 'Accept': 'application/json', 'User-Agent': UA } });
      if (!resp.ok) {
        if (resp.status === 429) {
          const ra = parseInt(resp.headers.get('retry-after') || '', 10);
          if (++rate > 10) throw new Error('ActiveCampaign 429: rate limit not clearing');
          await sleep((Number.isFinite(ra) && ra > 0) ? ra * 1000 : Math.min(1000 * 2 ** rate, 15000));
          continue;
        }
        const txt = await resp.text().catch(() => '');
        if (resp.status >= 400 && resp.status < 500) throw Object.assign(new Error(`ActiveCampaign ${resp.status}: ${txt.slice(0, 140)}`), { fatal: true });
        throw new Error(`ActiveCampaign ${resp.status}`);
      }
      return JSON.parse(await resp.text());
    } catch (err) { if (err.fatal) throw err; lastErr = err; tries++; if (tries < attempts) await sleep(700 * tries); }
  }
  throw lastErr;
}

// Offset-paginate a collection (key = the array property name in the response).
async function acAll(base, token, path, key, { maxPages = 20, limit = 100 } = {}) {
  const all = []; let offset = 0, pages = 0, total = Infinity;
  while (all.length < total && pages < maxPages) {
    const sep = path.includes('?') ? '&' : '?';
    const j = await acFetch(base, token, `${path}${sep}limit=${limit}&offset=${offset}`);
    const arr = j[key] || [];
    all.push(...arr);
    total = parseInt((j.meta && j.meta.total) || arr.length, 10);
    pages++; offset += limit;
    if (arr.length < limit) break;
    if (THROTTLE_MS) await sleep(THROTTLE_MS);
  }
  return all;
}
async function acCount(base, token, path) {
  const sep = path.includes('?') ? '&' : '?';
  const j = await acFetch(base, token, `${path}${sep}limit=1`);
  return parseInt((j.meta && j.meta.total) || 0, 10);
}

const num  = v => parseInt(v, 10) || 0;
const rate = (n, d) => d > 0 ? Math.round((n / d) * 1000) / 10 : 0;   // percentage, 1dp

async function computeACMetrics(creds, onProgress) {
  const { url: base, token } = creds;

  // List health — contact counts by status (1 active, 2 unsubscribed, 3 bounced/unconfirmed)
  if (onProgress) onProgress('contacts', 0);
  const totalContacts = await acCount(base, token, 'contacts');
  const active   = await acCount(base, token, 'contacts?status=1');
  const unsub    = await acCount(base, token, 'contacts?status=2');
  const bounced  = await acCount(base, token, 'contacts?status=3');

  // Campaign performance — ALL statuses (so the UI can filter sent/scheduled/draft/disabled)
  if (onProgress) onProgress('campaigns', 0);
  const CAMP_STATUS = { '0': 'Draft', '1': 'Scheduled', '2': 'Sending', '3': 'Paused', '4': 'Stopped', '5': 'Sent', '6': 'Disabled' };
  const camps = await acAll(base, token, 'campaigns?orders%5Bmdate%5D=DESC', 'campaigns', { maxPages: 6, limit: 100 });
  let S = 0, UO = 0, SC = 0, HB = 0, SB = 0, UN = 0, sentCount = 0;
  const campaignList = [];
  const monthly = {};   // 'YYYY-MM' -> { sends, sent, uo, sc, un, bo }
  for (const c of camps) {
    const st = String(c.status);
    const sent = num(c.send_amt);
    const isSent = st === '5' && sent > 0;
    const uo = num(c.uniqueopens), sc = num(c.subscriberclicks), un = num(c.unsubscribes), hb = num(c.hardbounces), sb = num(c.softbounces);
    if (isSent) {
      S += sent; UO += uo; SC += sc; HB += hb; SB += sb; UN += un; sentCount++;
      const m = String(c.sdate || '').slice(0, 7);
      if (m) { (monthly[m] || (monthly[m] = { sends: 0, sent: 0, uo: 0, sc: 0, un: 0, bo: 0 })); monthly[m].sends++; monthly[m].sent += sent; monthly[m].uo += uo; monthly[m].sc += sc; monthly[m].un += un; monthly[m].bo += hb + sb; }
    }
    campaignList.push({
      name: c.name, date: c.sdate || c.mdate || c.cdate, status: CAMP_STATUS[st] || 'Other', sent: isSent,
      recipients: sent,
      openRate: isSent ? rate(uo, sent) : null, clickRate: isSent ? rate(sc, sent) : null, ctor: isSent ? rate(sc, uo) : null,
      unsubRate: isSent ? rate(un, sent) : null, bounceRate: isSent ? rate(hb + sb, sent) : null,
    });
  }
  campaignList.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const deliverability = {
    sent: S, campaigns: sentCount,
    delivered: S - HB - SB, opened: UO, clicked: SC,
    avgOpenRate: rate(UO, S), avgClickRate: rate(SC, S), avgCtor: rate(SC, UO),
    unsubRate: rate(UN, S), bounceRate: rate(HB + SB, S), deliveryRate: rate(S - HB - SB, S),
    totalUnsubs: UN, totalBounces: HB + SB,
  };
  const monthlyArr = Object.keys(monthly).sort().map(m => ({
    month: m, sends: monthly[m].sends, sent: monthly[m].sent,
    openRate: rate(monthly[m].uo, monthly[m].sent), clickRate: rate(monthly[m].sc, monthly[m].sent),
    unsubRate: rate(monthly[m].un, monthly[m].sent), bounceRate: rate(monthly[m].bo, monthly[m].sent),
  }));

  // Automations — active count + entered/exited (completion)
  if (onProgress) onProgress('automations', 0);
  const autos = await acAll(base, token, 'automations', 'automations', { maxPages: 3, limit: 100 });
  let autoActive = 0, entered = 0, exited = 0;
  const automationList = autos.map(a => {
    const en = num(a.entered), ex = num(a.exited);
    if (String(a.status) === '1') autoActive++;
    entered += en; exited += ex;
    return { name: a.name, active: String(a.status) === '1', entered: en, exited: ex, inFlight: Math.max(0, en - ex), completion: rate(ex, en) };
  }).sort((a, b) => b.entered - a.entered);

  const campaignStatusCounts = campaignList.reduce((m, c) => { m[c.status] = (m[c.status] || 0) + 1; return m; }, {});

  // Contact lists — every list with its active subscriber count
  if (onProgress) onProgress('lists', 0);
  const acLists = await acAll(base, token, 'lists', 'lists', { maxPages: 6, limit: 100 });
  const lists = acLists.map(l => ({
    id: l.id, name: l.name,
    active: num(l.active_subscribers),
    total: num(l.non_deleted_subscribers),
    created: l.created_timestamp || l.cdate || null,
  })).sort((a, b) => b.active - a.active || a.name.localeCompare(b.name));
  const listsActiveTotal = lists.reduce((s, l) => s + l.active, 0);

  // Monthly snapshot of each list's active count (builds the growth-over-time series).
  try {
    const month = new Date().toISOString().slice(0, 7);   // YYYY-MM
    const { data: hRow } = await supabase.from('samcart_cache').select('data').eq('cache_key', 'ac_list_history').single();
    const hist = (hRow && hRow.data) ? JSON.parse(hRow.data) : {};
    for (const l of lists) (hist[l.id] = hist[l.id] || {})[month] = l.active;
    await supabase.from('samcart_cache').upsert({ cache_key: 'ac_list_history', data: JSON.stringify(hist), cached_at: new Date().toISOString() }, { onConflict: 'cache_key' });
  } catch { /* snapshot best-effort */ }

  return {
    configured: true, syncedAt: new Date().toISOString(),
    lists, listsActiveTotal,
    contacts: { total: totalContacts, active, unsubscribed: unsub, bounced, activeRate: rate(active, totalContacts), unsubRate: rate(unsub, totalContacts) },
    deliverability,
    campaigns: campaignList,
    campaignStatusCounts,
    monthly: monthlyArr,
    automations: { total: autos.length, active: autoActive, entered, exited, list: automationList },
  };
}

// ── Cache + sync (mirrors the Kajabi route) ───────────────────────
async function readCache() {
  const { data } = await supabase.from('samcart_cache').select('data, cached_at').eq('cache_key', CACHE_KEY).single();
  if (!data) return null;
  return { payload: JSON.parse(data.data), cachedAt: new Date(data.cached_at).getTime() };
}
async function writeCache(payload) {
  await supabase.from('samcart_cache').upsert(
    { cache_key: CACHE_KEY, data: JSON.stringify(payload), cached_at: new Date().toISOString() }, { onConflict: 'cache_key' });
}

const syncState = { running: false, phase: null, count: 0, startedAt: null, finishedAt: null, error: null };
async function runSync() {
  if (syncState.running) return;
  const creds = await getCreds();
  if (!creds.url || !creds.token) { syncState.error = 'No ActiveCampaign credentials configured.'; return; }
  syncState.running = true; syncState.phase = 'starting'; syncState.error = null;
  syncState.startedAt = new Date().toISOString(); syncState.finishedAt = null;
  try {
    const payload = await computeACMetrics(creds, (phase, n) => { syncState.phase = phase; syncState.count = n; });
    await writeCache(payload); syncState.phase = 'done';
  } catch (err) { syncState.error = err.message; }
  finally { syncState.running = false; syncState.finishedAt = new Date().toISOString(); }
}

router.get('/data', async (req, res) => {
  try {
    const creds = await getCreds();
    if (!creds.url || !creds.token) return res.json({ configured: false });
    const cache = await readCache();
    if (cache) {
      const stale = Date.now() - cache.cachedAt >= CACHE_TTL;
      if (stale && !syncState.running) runSync();
      return res.json({ ...cache.payload, stale });
    }
    const payload = await computeACMetrics(creds);
    await writeCache(payload);
    res.json(payload);
  } catch (err) {
    const cache = await readCache().catch(() => null);
    if (cache) return res.json({ ...cache.payload, stale: true, error: err.message });
    res.status(500).json({ configured: true, error: err.message });
  }
});
// On-demand month-by-month growth for one list: additions (join date) + removals
// (unsubscribe date) per month, the reconstructed active line, and any monthly snapshots.
router.get('/list-growth', async (req, res) => {
  try {
    const listid = parseInt(req.query.listid, 10);
    if (!listid) return res.status(400).json({ error: 'listid required' });
    const creds = await getCreds();
    if (!creds.url || !creds.token) return res.status(400).json({ error: 'ActiveCampaign not configured' });
    const ckey = 'ac_growth:' + listid;
    // serve cached (1-day) unless ?force=1
    if (!req.query.force) {
      const { data: c } = await supabase.from('samcart_cache').select('data, cached_at').eq('cache_key', ckey).single();
      if (c && c.data && (Date.now() - new Date(c.cached_at).getTime() < 24 * 3600 * 1000)) return res.json(JSON.parse(c.data));
    }
    const { url: base, token } = creds;
    // contactLists ignores listid filters, so page through contacts?listid=X with the
    // membership records included, and keep the ones for this list (sdate/udate/status).
    const totalMembers = await acCount(base, token, `contacts?listid=${listid}`);
    const MAXP = 100, LIMIT = 100;
    const recs = [];
    let offset = 0, pages = 0;
    while (pages < MAXP) {
      const j = await acFetch(base, token, `contacts?listid=${listid}&include=contactLists&limit=${LIMIT}&offset=${offset}`);
      for (const cl of (j.contactLists || [])) if (String(cl.list) === String(listid)) recs.push(cl);
      const got = (j.contacts || []).length;
      pages++; offset += LIMIT;
      if (got < LIMIT) break;
      if (THROTTLE_MS) await sleep(THROTTLE_MS);
    }
    const capped = totalMembers > recs.length;

    const added = {}, removed = {};
    let activeInFetch = 0;
    for (const r of recs) {
      const sm = String(r.sdate || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(sm)) added[sm] = (added[sm] || 0) + 1;
      if (String(r.status) === '1') activeInFetch++;
      else if (String(r.status) === '2' && r.udate) { const um = String(r.udate).slice(0, 7); if (/^\d{4}-\d{2}$/.test(um)) removed[um] = (removed[um] || 0) + 1; }
    }
    // anchor the active line to the list's true current active count (from the AC cache)
    let currentActive = activeInFetch;
    try {
      const { data: m } = await supabase.from('samcart_cache').select('data').eq('cache_key', CACHE_KEY).single();
      const L = m && m.data && (JSON.parse(m.data).lists || []).find(x => String(x.id) === String(listid));
      if (L) currentActive = L.active;
    } catch { /* fall back to fetched count */ }
    // monthly snapshots (reliable net over time, going forward)
    let snaps = {};
    try {
      const { data: h } = await supabase.from('samcart_cache').select('data').eq('cache_key', 'ac_list_history').single();
      if (h && h.data) snaps = JSON.parse(h.data)[listid] || {};
    } catch { /* none yet */ }

    const months = [...new Set([...Object.keys(added), ...Object.keys(removed), ...Object.keys(snaps)])].sort();
    // reconstruct active-at-end-of-month backwards from the current active count
    const activeLine = {};
    let run = currentActive;
    for (let i = months.length - 1; i >= 0; i--) {
      const m = months[i];
      activeLine[m] = (snaps[m] != null) ? snaps[m] : run;     // prefer a real snapshot
      run = activeLine[m] - ((added[m] || 0) - (removed[m] || 0));
    }
    const series = months.map(m => ({ month: m, added: added[m] || 0, removed: removed[m] || 0, net: (added[m] || 0) - (removed[m] || 0), active: Math.max(0, Math.round(activeLine[m])) }));
    const payload = { listid, currentActive, totalMembers, fetched: recs.length, capped, series };
    await supabase.from('samcart_cache').upsert({ cache_key: ckey, data: JSON.stringify(payload), cached_at: new Date().toISOString() }, { onConflict: 'cache_key' });
    res.json(payload);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/sync', async (req, res) => {
  const creds = await getCreds();
  if (!creds.url || !creds.token) return res.status(400).json({ error: 'No ActiveCampaign credentials configured.' });
  runSync();
  res.json({ started: true });
});
router.get('/sync/status', (req, res) => res.json(syncState));

module.exports = router;
