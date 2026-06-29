const express  = require('express');
const router   = express.Router();
const fetch    = require('node-fetch');
const supabase = require('../database');
// Eastern-Time month 'YYYY-MM' for monthly snapshots.
const etMonth = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).format(d instanceof Date ? d : new Date(d));

// Apify Facebook Pages Scraper. Run ~monthly, snapshot the follower count per month,
// and derive "followers gained this month" = current − last month's snapshot.
const CACHE_KEY     = 'facebook_metrics';
const DEFAULT_ACTOR = '4Hv5RhChiaDk6iwad';   // apify/facebook-pages-scraper
const DEFAULT_PAGE  = 'https://www.facebook.com/taniakhazaal/';

async function getCreds() {
  const { data } = await supabase.from('settings').select('key, value')
    .in('key', ['apify_token', 'apify_fb_actor_id', 'facebook_page_url']);
  const s = Object.fromEntries((data || []).map(r => [r.key, r.value]));
  return {
    token:   s.apify_token       || process.env.APIFY_TOKEN || '',
    actor:   s.apify_fb_actor_id || DEFAULT_ACTOR,
    pageUrl: (s.facebook_page_url || DEFAULT_PAGE).trim(),
  };
}

const prevMonth = m => {
  const [y, mo] = String(m).split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1, 1)); d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

async function getCache() {
  const { data } = await supabase.from('samcart_cache').select('data').eq('cache_key', CACHE_KEY).single();
  if (!data) return null;
  try { return JSON.parse(data.data); } catch { return null; }
}
async function setCache(payload) {
  await supabase.from('samcart_cache').upsert(
    { cache_key: CACHE_KEY, data: JSON.stringify(payload), cached_at: new Date().toISOString() },
    { onConflict: 'cache_key' });
}

let syncState = { running: false, error: null, startedAt: null, finishedAt: null };

// Run the actor synchronously and return its first dataset item (the page).
async function runScrape(creds) {
  const url = `https://api.apify.com/v2/acts/${creds.actor}/run-sync-get-dataset-items?token=${encodeURIComponent(creds.token)}`;
  const resp = await fetch(url, {
    method: 'POST', timeout: 180000,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startUrls: [{ url: creds.pageUrl }] }),
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Apify ${resp.status}: ${txt.slice(0, 180)}`);
  const items = JSON.parse(txt);
  const o = Array.isArray(items) ? items[0] : items;
  if (!o || o.followers == null) throw new Error('No follower data returned for ' + creds.pageUrl);
  return o;
}

async function syncFacebook() {
  syncState = { running: true, error: null, startedAt: new Date().toISOString(), finishedAt: null };
  try {
    const creds = await getCreds();
    if (!creds.token) throw new Error('No Apify token configured');
    const o = await runScrape(creds);
    const month = etMonth(new Date());
    const prev = (await getCache()) || {};
    const history = Object.assign({}, prev.history || {});
    history[month] = o.followers;                     // latest reading for this month
    const prevVal = history[prevMonth(month)];
    const gainThisMonth = (prevVal != null) ? (o.followers - prevVal) : null;
    const payload = {
      configured: true,
      name: o.title || o.pageName || '', pageName: o.pageName || '', category: o.category || '',
      followers: o.followers, likes: o.likes, profilePic: o.profilePictureUrl || '',
      pageUrl: creds.pageUrl,
      history, gainThisMonth, month, syncedAt: new Date().toISOString(),
    };
    await setCache(payload);
    syncState.finishedAt = new Date().toISOString();
    return payload;
  } catch (e) { syncState.error = e.message; throw e; }
  finally { syncState.running = false; }
}

// Cached metrics; lazily kicks a fresh run once per calendar month (Eastern).
router.get('/data', async (req, res) => {
  try {
    const cache = await getCache();
    const month = etMonth(new Date());
    if ((!cache || !(cache.history && cache.history[month])) && !syncState.running) {
      syncFacebook().catch(() => {});   // background — return cache instantly
    }
    res.json(cache || { configured: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/sync', (req, res) => {
  if (syncState.running) return res.json({ running: true });
  syncFacebook().catch(() => {});
  res.json({ started: true });
});
router.get('/sync/status', (req, res) => res.json(syncState));

module.exports = router;
