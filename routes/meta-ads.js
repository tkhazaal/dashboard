const express  = require('express');
const router   = express.Router();
const fetch    = require('node-fetch');
const crypto   = require('crypto');
const supabase = require('../database');

// Meta Marketing API (read-only ad reporting). Long-term auth = a System User token
// (never expires). Credentials live in the settings table (masked on GET), never in git.
const GRAPH = 'https://graph.facebook.com/v21.0';

async function getCreds() {
  const { data } = await supabase.from('settings').select('key, value')
    .in('key', ['meta_ads_token', 'meta_ad_account_id', 'meta_app_secret']);
  const s = Object.fromEntries((data || []).map(r => [r.key, r.value]));
  let acct = (s.meta_ad_account_id || '').trim();
  if (acct && !/^act_/.test(acct)) acct = 'act_' + acct.replace(/[^0-9]/g, '');   // accept bare numeric id too
  return { token: (s.meta_ads_token || '').trim(), acct, secret: (s.meta_app_secret || '').trim() };
}
const proof = (token, secret) => secret ? crypto.createHmac('sha256', secret).update(token).digest('hex') : null;

async function graph(path, params, creds) {
  const u = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  u.searchParams.set('access_token', creds.token);
  const pr = proof(creds.token, creds.secret); if (pr) u.searchParams.set('appsecret_proof', pr);
  const r = await fetch(u.href, { timeout: 60000 });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { throw new Error('Meta API: ' + t.slice(0, 160)); }
  if (j.error) { const e = new Error(j.error.message || 'Meta API error'); e.metaCode = j.error.code; throw e; }
  return j;
}
async function graphAll(path, params, creds, cap = 2000) {
  let page = await graph(path, params, creds), out = (page.data || []).slice(), g = 0;
  while (page.paging && page.paging.next && out.length < cap && g++ < 40) {
    const r = await fetch(page.paging.next, { timeout: 60000 }); const t = await r.text();
    try { page = JSON.parse(t); } catch { break; }
    if (page.error) break;
    out = out.concat(page.data || []);
  }
  return out;
}

const N = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
// Pick ONE purchase metric in priority order — omni_purchase is Meta's deduped total,
// so summing it with its sub-types (fb_pixel_purchase, web_in_store…) would double-count.
const PURCHASE = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase', 'web_in_store_purchase', 'onsite_web_purchase'];
const pickAction = (arr, types) => { if (!Array.isArray(arr)) return 0; for (const t of types) { const a = arr.find(x => x.action_type === t); if (a) return N(a.value); } return 0; };
function norm(row) {
  const spend = N(row.spend), purchases = pickAction(row.actions, PURCHASE), revenue = pickAction(row.action_values, PURCHASE);
  const roas = spend ? revenue / spend : 0;   // keep ROAS consistent with the Revenue we display (Revenue ÷ Spend)
  return {
    name: row.campaign_name || row.adset_name || row.ad_name || 'Account', id: row.campaign_id || row.adset_id || row.ad_id || '',
    spend: Math.round(spend * 100) / 100, impressions: N(row.impressions), reach: N(row.reach), frequency: Math.round(N(row.frequency) * 100) / 100,
    clicks: N(row.clicks), linkClicks: N(row.inline_link_clicks), cpc: Math.round(N(row.cpc) * 100) / 100, cpm: Math.round(N(row.cpm) * 100) / 100, ctr: Math.round(N(row.ctr) * 100) / 100,
    purchases, revenue: Math.round(revenue * 100) / 100, roas: Math.round(roas * 100) / 100,
    cpa: purchases ? Math.round(spend / purchases * 100) / 100 : 0,
    date_start: row.date_start, date_stop: row.date_stop,
  };
}

const PRESET_MAP = { today: 'today', yesterday: 'yesterday', thisweek: 'this_week_mon_today', lastweek: 'last_week_mon_sun', thismonth: 'this_month', lastmonth: 'last_month', thisyear: 'this_year', all: 'maximum', last7: 'last_7d', last30: 'last_30d' };
const FIELDS = 'spend,impressions,reach,frequency,clicks,inline_link_clicks,cpc,cpm,ctr,actions,action_values,purchase_roas,account_currency';

async function pull(preset, since, until, creds) {
  creds = creds || await getCreds();
  if (!creds.token || !creds.acct) return { configured: false };
  const range = (preset === 'custom' && since && until) ? { time_range: { since, until } } : { date_preset: PRESET_MAP[preset] || 'last_30d' };
  let account = { id: creds.acct };
  try { const a = await graph(creds.acct, { fields: 'name,currency,account_status,timezone_name' }, creds); account = { id: creds.acct, name: a.name, currency: a.currency, status: a.account_status, tz: a.timezone_name }; }
  catch (e) { account = { id: creds.acct, error: e.message }; if (e.metaCode === 190) throw e; }   // bad token → surface immediately
  const totRows  = await graphAll(`${creds.acct}/insights`, { level: 'account', fields: FIELDS, ...range }, creds, 5);
  const totals   = totRows.length ? norm(totRows[0]) : norm({});
  const campRows = await graphAll(`${creds.acct}/insights`, { level: 'campaign', fields: 'campaign_name,campaign_id,' + FIELDS, limit: 200, ...range }, creds);
  const campaigns = campRows.map(norm).filter(c => c.spend > 0 || c.impressions > 0).sort((a, b) => b.spend - a.spend);
  let daily = [];
  try { const d = await graphAll(`${creds.acct}/insights`, { level: 'account', time_increment: 1, date_preset: 'last_90d', fields: FIELDS }, creds, 200); daily = d.map(norm); } catch {}
  const currency = account.currency || (totRows[0] && totRows[0].account_currency) || 'USD';
  return { configured: true, account, totals, campaigns, daily, preset, currency, syncedAt: new Date().toISOString() };
}

let _cache = {};   // ckey -> { at, payload }  (short in-memory cache so rapid re-renders don't re-hit Meta)
router.get('/data', async (req, res) => {
  try {
    const preset = req.query.preset || 'last30', since = req.query.since, until = req.query.until;
    const creds = await getCreds();
    if (!creds.token || !creds.acct) return res.json({ configured: false });
    // Key the cache by account+token too, so changing credentials in Settings doesn't serve stale data.
    const ckey = `${creds.acct}|${creds.token.slice(-6)}|${preset === 'custom' ? `custom:${since}:${until}` : preset}`;
    const hit = _cache[ckey];
    if (hit && (Date.now() - hit.at) < 5 * 60 * 1000 && req.query.force !== '1') return res.json({ ...hit.payload, fromCache: true });
    const payload = await pull(preset, since, until, creds);
    if (payload.configured) _cache[ckey] = { at: Date.now(), payload };
    res.json(payload);
  } catch (err) { res.json({ configured: true, error: err.message }); }
});
router.get('/status', async (req, res) => { try { const c = await getCreds(); res.json({ configured: !!(c.token && c.acct), account: c.acct || null }); } catch (e) { res.json({ configured: false, error: e.message }); } });

module.exports = router;
