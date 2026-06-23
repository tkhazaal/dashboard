const express  = require('express');
const router   = express.Router();
const fetch    = require('node-fetch');
const supabase = require('../database');

const BASE_URL   = 'https://api.kajabi.com/v1';
const TOKEN_URL  = 'https://api.kajabi.com/v1/oauth/token';
const CACHE_KEY  = 'kajabi_metrics';
const CACHE_TTL  = parseInt(process.env.KAJABI_CACHE_MINUTES || '180', 10) * 60 * 1000;
const PAGE_SIZE  = Math.min(100, Math.max(10, parseInt(process.env.KAJABI_PAGE_SIZE || '100', 10)));
const THROTTLE_MS = Math.max(0, parseInt(process.env.KAJABI_THROTTLE_MS || '120', 10));

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Credentials (settings table, fallback to env) ─────────────────
async function getCreds() {
  const { data } = await supabase.from('settings').select('key, value')
    .in('key', ['kajabi_client_id', 'kajabi_client_secret']);
  const s = Object.fromEntries((data || []).map(r => [r.key, r.value]));
  return {
    clientId:     s.kajabi_client_id     || process.env.KAJABI_CLIENT_ID     || '',
    clientSecret: s.kajabi_client_secret || process.env.KAJABI_CLIENT_SECRET || '',
  };
}

// ── OAuth token (client_credentials), cached in memory until ~expiry ──
let _token = null, _tokenExp = 0;
async function getToken(creds) {
  if (_token && Date.now() < _tokenExp - 60000) return _token;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.clientId, client_secret: creds.clientSecret,
  });
  const resp = await fetch(TOKEN_URL, {
    method: 'POST', timeout: 30000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const txt = await resp.text();
  if (!resp.ok) throw Object.assign(new Error(`Kajabi auth ${resp.status}: ${txt.slice(0, 160)}`), { fatal: true });
  const json = JSON.parse(txt);
  _token = json.access_token;
  _tokenExp = Date.now() + (parseInt(json.expires_in, 10) || 600000) * 1000;
  return _token;
}

// ── Fetch one URL as JSON (Bearer); handles 429 + one 401 refresh ──
async function kjFetch(url, creds, attempts = 5) {
  let lastErr, tries = 0, rateWaits = 0, refreshed = false;
  while (tries < attempts) {
    try {
      const token = await getToken(creds);
      const resp = await fetch(url, { timeout: 45000, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (!resp.ok) {
        if (resp.status === 429) {
          const ra = parseInt(resp.headers.get('retry-after') || '', 10);
          const wait = (Number.isFinite(ra) && ra > 0) ? ra * 1000 : Math.min(2000 * 2 ** rateWaits, 30000);
          if (++rateWaits > 10) throw new Error('Kajabi API 429: rate limit not clearing');
          await sleep(wait); continue;
        }
        if (resp.status === 401 && !refreshed) {   // token expired — refresh once
          refreshed = true; _token = null; _tokenExp = 0; continue;
        }
        const txt = await resp.text().catch(() => '');
        if (resp.status >= 400 && resp.status < 500) {
          throw Object.assign(new Error(`Kajabi API ${resp.status}: ${txt.slice(0, 160)}`), { fatal: true });
        }
        throw new Error(`Kajabi API ${resp.status}`);
      }
      return JSON.parse(await resp.text());
    } catch (err) {
      if (err.fatal) throw err;
      lastErr = err; tries++;
      if (tries < attempts) await sleep(800 * tries);
    }
  }
  throw lastErr;
}

// Follow JSON:API links.next until exhausted (bounded by maxPages).
async function fetchAll(path, creds, { maxPages = 100, onProgress, includedMap } = {}) {
  const all = [];
  let url = `${BASE_URL}/${path}${path.includes('?') ? '&' : '?'}page%5Bsize%5D=${PAGE_SIZE}`;
  let pages = 0;
  while (url && pages < maxPages) {
    const json = await kjFetch(url, creds);
    const data = json.data || [];
    all.push(...data);
    if (includedMap && Array.isArray(json.included)) for (const r of json.included) includedMap[`${r.type}:${r.id}`] = r;
    pages++;
    if (onProgress) onProgress(all.length);
    url = json.links && json.links.next ? json.links.next : null;
    if (url && THROTTLE_MS) await sleep(THROTTLE_MS);
  }
  return all;
}

// Cheap total count for a collection (meta.total on page size 1).
async function fetchCount(path, creds) {
  try {
    const json = await kjFetch(`${BASE_URL}/${path}?page%5Bsize%5D=1`, creds);
    return (json.meta && (json.meta.total ?? json.meta.record_count)) ?? null;
  } catch { return null; }
}

const attrs = r => (r && r.attributes) || {};
const cents = v => (parseFloat(v) || 0) / 100;

// Site id (required by the transactions filter)
let _siteId = null;
async function getSiteId(creds) {
  if (_siteId) return _siteId;
  const json = await kjFetch(`${BASE_URL}/sites?page%5Bsize%5D=1`, creds);
  _siteId = json.data && json.data[0] && json.data[0].id;
  return _siteId;
}

async function computeKajabiMetrics(creds, onProgress) {
  // Orders → revenue & order counts (paid total). Sideload customers for names.
  const inc = {};
  const orders = await fetchAll('orders?include=customer', creds, { maxPages: 300, includedMap: inc, onProgress: n => onProgress && onProgress('orders', n) });
  let totalRevenue = 0, grossRevenue = 0;
  const monthly = {};          // 'YYYY-MM' -> { revenue, orders }
  const recent = [];
  for (const o of orders) {
    const a = attrs(o);
    const rev = cents(a.total_price_in_cents);
    totalRevenue += rev;
    grossRevenue += cents(a.subtotal_in_cents);
    const m = String(a.created_at || '').slice(0, 7);
    if (m) { (monthly[m] || (monthly[m] = { revenue: 0, orders: 0 })); monthly[m].revenue += rev; monthly[m].orders++; }
  }
  const orderCount = orders.length;
  // recent 10 (orders come oldest-first; take the last 10 reversed) with customer name
  for (const o of orders.slice(-10).reverse()) {
    const a = attrs(o);
    const cref = o.relationships && o.relationships.customer && o.relationships.customer.data;
    const cust = cref && inc[`${cref.type}:${cref.id}`];
    const ca = attrs(cust);
    recent.push({
      order: a.order_number,
      customer: ca.name || ca.email || (cref ? `Customer #${cref.id}` : '—'),
      total: cents(a.total_price_in_cents),
      date: a.created_at,
    });
  }

  // Order items → sales by offer
  const items = await fetchAll('order_items', creds, { maxPages: 300, onProgress: n => onProgress && onProgress('order_items', n) });
  const byOffer = {};
  for (const it of items) {
    const a = attrs(it);
    const title = a.title || 'Unknown';
    (byOffer[title] || (byOffer[title] = { title, orders: 0, revenue: 0 }));
    byOffer[title].orders += (parseInt(a.quantity, 10) || 1);
    byOffer[title].revenue += cents(a.total_price_in_cents);
  }
  const topOffers = Object.values(byOffer).sort((a, b) => b.revenue - a.revenue);

  // Contacts → audience size (count only)
  const contactCount = await fetchCount('contacts', creds);

  // Purchases → subscription breakdown (active = not deactivated)
  let subsActive = 0, subsTotal = 0, oneTime = 0, purchasesScanned = 0, purchasesTruncated = false;
  try {
    const purchases = await fetchAll('purchases', creds, { maxPages: 200, onProgress: n => onProgress && onProgress('purchases', n) });
    purchasesScanned = purchases.length;
    purchasesTruncated = purchases.length >= 200 * PAGE_SIZE;
    for (const p of purchases) {
      const a = attrs(p);
      const isSub = /subscription|recurring|payment_plan|multipay/i.test(String(a.payment_type || ''));
      if (isSub) { subsTotal++; if (!a.deactivated_at) subsActive++; }
      else oneTime++;
    }
  } catch { /* subscriptions are best-effort */ }

  // Refunds & charges (transactions — needs site_id filter). action: charge | refund
  let totalRefunded = 0, refundCount = 0;
  try {
    const siteId = await getSiteId(creds);
    if (siteId) {
      const txns = await fetchAll(`transactions?filter%5Bsite_id%5D=${siteId}`, creds, { maxPages: 300, onProgress: n => onProgress && onProgress('transactions', n) });
      for (const t of txns) {
        const a = attrs(t);
        if (/refund/i.test(String(a.action || ''))) { totalRefunded += Math.abs(cents(a.amount_in_cents)); refundCount++; }
      }
    }
  } catch { /* refunds best-effort */ }

  // Engagement / login (customers carry sign_in_count + last_request_at)
  let custTotal = 0, loggedIn = 0, active30 = 0, signInSum = 0;
  try {
    const cust = await fetchAll('customers', creds, { maxPages: 300, onProgress: n => onProgress && onProgress('customers', n) });
    const cutoff = Date.now() - 30 * 86400000;
    for (const c of cust) {
      const a = attrs(c);
      custTotal++;
      const si = parseInt(a.sign_in_count, 10) || 0;
      signInSum += si;
      if (si > 0) loggedIn++;
      if (a.last_request_at && new Date(a.last_request_at).getTime() >= cutoff) active30++;
    }
  } catch { /* engagement best-effort */ }
  const pct = (n, d) => d ? Math.round((n / d) * 1000) / 10 : 0;

  const monthlyArr = Object.keys(monthly).sort().map(m => ({ month: m, revenue: Math.round(monthly[m].revenue * 100) / 100, orders: monthly[m].orders }));

  return {
    configured: true,
    syncedAt: new Date().toISOString(),
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    grossRevenue: Math.round(grossRevenue * 100) / 100,
    orderCount,
    avgOrderValue: orderCount ? Math.round((totalRevenue / orderCount) * 100) / 100 : 0,
    totalRefunded: Math.round(totalRefunded * 100) / 100,
    refundCount,
    netRevenue: Math.round((totalRevenue - totalRefunded) * 100) / 100,
    contactCount,
    purchaseCount: purchasesScanned,
    subscriptions: { active: subsActive, total: subsTotal, oneTime, scanned: purchasesScanned, truncated: purchasesTruncated },
    engagement: { customers: custTotal, loggedIn, loginRate: pct(loggedIn, custTotal), active30, activeRate: pct(active30, custTotal), avgSignIns: custTotal ? Math.round((signInSum / custTotal) * 10) / 10 : 0 },
    monthly: monthlyArr,
    topOffers,
    recent,
  };
}

// ── Cache ─────────────────────────────────────────────────────────
async function readCache() {
  const { data } = await supabase.from('samcart_cache').select('data, cached_at').eq('cache_key', CACHE_KEY).single();
  if (!data) return null;
  return { payload: JSON.parse(data.data), cachedAt: new Date(data.cached_at).getTime() };
}
async function writeCache(payload) {
  await supabase.from('samcart_cache').upsert(
    { cache_key: CACHE_KEY, data: JSON.stringify(payload), cached_at: new Date().toISOString() },
    { onConflict: 'cache_key' });
}

// ── Background sync ───────────────────────────────────────────────
const syncState = { running: false, phase: null, count: 0, startedAt: null, finishedAt: null, error: null };
async function runSync() {
  if (syncState.running) return;
  const creds = await getCreds();
  if (!creds.clientId || !creds.clientSecret) { syncState.error = 'No Kajabi credentials configured.'; return; }
  syncState.running = true; syncState.phase = 'starting'; syncState.count = 0; syncState.error = null;
  syncState.startedAt = new Date().toISOString(); syncState.finishedAt = null;
  try {
    const payload = await computeKajabiMetrics(creds, (phase, n) => { syncState.phase = phase; syncState.count = n; });
    await writeCache(payload);
    syncState.phase = 'done';
  } catch (err) {
    syncState.error = err.message;
  } finally {
    syncState.running = false; syncState.finishedAt = new Date().toISOString();
  }
}

// ── Routes ────────────────────────────────────────────────────────
router.get('/data', async (req, res) => {
  try {
    const creds = await getCreds();
    if (!creds.clientId || !creds.clientSecret) return res.json({ configured: false });
    const cache = await readCache();
    if (cache) {
      // Always return the cached payload immediately; if stale, refresh in the
      // background (a full crawl can exceed a proxy timeout, so never block on it).
      const stale = Date.now() - cache.cachedAt >= CACHE_TTL;
      if (stale && !syncState.running) runSync();
      return res.json({ ...cache.payload, stale });
    }
    // No cache yet — build once inline (first run only) and cache it.
    const payload = await computeKajabiMetrics(creds);
    await writeCache(payload);
    res.json(payload);
  } catch (err) {
    const cache = await readCache().catch(() => null);
    if (cache) return res.json({ ...cache.payload, stale: true, error: err.message });
    res.status(500).json({ configured: true, error: err.message });
  }
});

router.post('/sync', async (req, res) => {
  const creds = await getCreds();
  if (!creds.clientId || !creds.clientSecret) return res.status(400).json({ error: 'No Kajabi credentials configured.' });
  runSync();                          // fire-and-forget
  res.json({ started: true });
});

router.get('/sync/status', (req, res) => res.json(syncState));

module.exports = router;
