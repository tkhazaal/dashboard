const express  = require('express');
const router   = express.Router();
const fetch    = require('node-fetch');
const supabase = require('../database');

// ── Config (Apify token + targets) ──────────────────────────────────
const FB_PAGE      = 'https://www.facebook.com/taniakhazaal';
const IG_USER      = 'taniakhazaal';
const RESULTS      = 30;   // rolling window per scraper — new posts + recent ones get their metrics refreshed

async function getCreds() {
  const { data } = await supabase.from('settings').select('key, value')
    .in('key', ['apify_token', 'facebook_page_url', 'instagram_username']);
  const s = Object.fromEntries((data || []).map(r => [r.key, r.value]));
  return {
    token:  s.apify_token || process.env.APIFY_TOKEN || '',
    fbPage: (s.facebook_page_url || FB_PAGE).trim(),
    igUser: (s.instagram_username || IG_USER).replace(/^@/, '').trim(),
  };
}

const num = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const iso = v => { if (!v) return null; if (typeof v === 'number') return new Date(v * 1000).toISOString(); const d = new Date(v); return isNaN(d) ? null : d.toISOString(); };

async function runActor(token, actor, payload) {
  try {
    const r = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`, {
      method: 'POST', timeout: 240000, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`${actor} ${r.status}: ${t.slice(0, 140)}`);
    return JSON.parse(t);
  } catch (e) { console.error('Apify', actor, e.message); return []; }
}

// ── Normalizers (one per scraper) → { key, platform, content_type, url, posted_at, caption, thumbnail, views, likes, comments, shares } ──
function parseFbReel(o) {
  const vid = o && o.video && o.video.id; if (!vid) return null;
  return { key: 'fb_' + vid, platform: 'Facebook', content_type: 'Reel',
    url: o.shareable_url || o.topLevelReelUrl || `https://www.facebook.com/reel/${vid}`,
    posted_at: iso(o.time), caption: o.text || '', thumbnail: (o.video && o.video.first_frame_thumbnail) || '',
    views: num(o.playCountRounded), likes: 0, comments: 0, shares: 0 };
}
function parseFbPost(o) {
  if (!o || (!o.postId && !o.url)) return null;
  const reel = String(o.url || '').match(/\/reel\/(\d+)/);
  return { key: 'fb_' + (reel ? reel[1] : o.postId), platform: 'Facebook',
    content_type: reel ? 'Reel' : (o.isVideo ? 'Video' : 'Post'),
    url: o.url || o.topLevelUrl || '', posted_at: iso(o.time || o.timestamp), caption: o.text || '', thumbnail: '',
    views: num(o.viewsCount || o.videoPostViewCount), likes: num(o.likes), comments: num(o.comments), shares: num(o.shares) };
}
function parseIg(o) {
  if (!o || !o.id) return null;
  const isVid = o.type === 'Video' || o.productType === 'clips';
  return { key: 'ig_' + o.id, platform: 'Instagram', content_type: isVid ? 'Reel' : 'Post',
    url: o.url || '', posted_at: iso(o.timestamp), caption: o.caption || '', thumbnail: o.displayUrl || '',
    views: num(o.videoPlayCount || o.videoViewCount), likes: num(o.likesCount), comments: num(o.commentsCount),
    shares: num(o.sharesCount || o.reshareCount || o.sharescount) };
}

let syncState = { running: false, error: null, startedAt: null, finishedAt: null, upserted: 0 };

async function syncSocial() {
  if (syncState.running) return;
  syncState = { running: true, error: null, startedAt: new Date().toISOString(), finishedAt: null, upserted: 0 };
  try {
    const { token, fbPage, igUser } = await getCreds();
    if (!token) throw new Error('No Apify token configured');
    const [fbReels, igReels, fbPosts, igPosts] = await Promise.all([
      runActor(token, 'apify~facebook-reels-scraper',  { resultsLimit: RESULTS, startUrls: [{ url: fbPage }] }),
      runActor(token, 'apify~instagram-reel-scraper',  { includeDownloadedVideo: false, includeTranscript: false, includeSharesCount: true, resultsLimit: RESULTS, skipPinnedPosts: false, skipTrialReels: false, username: [igUser] }),
      runActor(token, 'apify~facebook-posts-scraper',  { captionText: true, resultsLimit: RESULTS, startUrls: [{ url: fbPage }] }),
      runActor(token, 'apify~instagram-post-scraper',  { dataDetailLevel: 'basicData', resultsLimit: RESULTS, skipPinnedPosts: false, username: [igUser] }),
    ]);
    const parsed = [
      ...(fbReels || []).map(parseFbReel),
      ...(fbPosts || []).map(parseFbPost),
      ...(igReels || []).map(parseIg),
      ...(igPosts || []).map(parseIg),
    ].filter(Boolean);

    // Merge by key — take the richest value for each metric across scrapers.
    const merged = {};
    for (const p of parsed) {
      const e = merged[p.key];
      if (!e) { merged[p.key] = { ...p }; continue; }
      e.views = Math.max(e.views, p.views); e.likes = Math.max(e.likes, p.likes);
      e.comments = Math.max(e.comments, p.comments); e.shares = Math.max(e.shares, p.shares);
      e.caption = e.caption || p.caption; e.url = e.url || p.url; e.thumbnail = e.thumbnail || p.thumbnail;
      if (!e.posted_at) e.posted_at = p.posted_at;
      if (p.content_type === 'Reel') e.content_type = 'Reel';
    }
    // Upsert scraped columns only — manual columns (hook_topic, offer, status, notes, post_num) are
    // omitted from the payload so they're preserved on conflict.
    const rows = Object.values(merged).map(p => ({
      post_id: p.key, platform: p.platform, content_type: p.content_type, url: p.url,
      posted_at: p.posted_at, caption: p.caption, thumbnail: p.thumbnail,
      views: p.views, likes: p.likes, comments: p.comments, shares: p.shares,
      last_updated: new Date().toISOString(),
    }));
    if (rows.length) {
      const { error } = await supabase.from('social_posts').upsert(rows, { onConflict: 'post_id' });
      if (error) throw error;
    }
    syncState.upserted = rows.length;
    syncState.finishedAt = new Date().toISOString();
  } catch (e) { syncState.error = e.message; throw e; }
  finally { syncState.running = false; }
}

// ── Endpoints ───────────────────────────────────────────────────────
router.get('/data', async (req, res) => {
  try {
    const { data, error } = await supabase.from('social_posts').select('*').order('posted_at', { ascending: false }).limit(2000);
    if (error) throw error;
    const posts = data || [];
    const sum = f => posts.reduce((s, p) => s + (p[f] || 0), 0);
    const byPlatform = {}, byType = {};
    for (const p of posts) {
      const pl = byPlatform[p.platform] || (byPlatform[p.platform] = { platform: p.platform, posts: 0, views: 0, likes: 0, comments: 0, shares: 0 });
      pl.posts++; pl.views += p.views || 0; pl.likes += p.likes || 0; pl.comments += p.comments || 0; pl.shares += p.shares || 0;
      byType[p.content_type] = (byType[p.content_type] || 0) + 1;
    }
    res.json({
      posts,
      totals: { posts: posts.length, views: sum('views'), likes: sum('likes'), comments: sum('comments'), shares: sum('shares') },
      byPlatform: Object.values(byPlatform),
      byType: Object.entries(byType).map(([type, count]) => ({ type, count })),
      top: [...posts].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 8),
      synced: syncState.finishedAt,
    });
  } catch (err) { res.status(500).json({ error: err.message, configured: false }); }
});
// Edit a manual annotation on a post.
router.post('/field', async (req, res) => {
  try {
    const { post_id, field } = req.body;
    const allowed = ['post_num', 'hook_topic', 'offer', 'status', 'notes'];
    if (!post_id || !allowed.includes(field)) return res.status(400).json({ error: 'invalid' });
    const { error } = await supabase.from('social_posts').update({ [field]: (req.body.value || '').toString().slice(0, 2000) }).eq('post_id', post_id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/sync', (req, res) => { if (syncState.running) return res.json({ running: true }); syncSocial().catch(() => {}); res.json({ started: true }); });
router.get('/sync/status', (req, res) => res.json(syncState));

// ── Daily 8 AM (Eastern) scheduler ──────────────────────────────────
let _lastRun = '';
function etParts() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }).formatToParts(new Date());
  const g = t => (p.find(x => x.type === t) || {}).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: g('hour') };
}
setInterval(() => {
  const { date, hour } = etParts();
  if ((hour === '08' || hour === '8') && _lastRun !== date) { _lastRun = date; syncSocial().catch(e => console.error('social autosync', e.message)); }
}, 9 * 60 * 1000);   // check every ~9 min; fires once when it's 8am ET

module.exports = router;
module.exports.syncSocial = syncSocial;
