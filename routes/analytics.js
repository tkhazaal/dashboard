const express  = require('express');
const router   = express.Router();
const supabase = require('../database');

function safeDays(val) {
  const n = parseInt(val, 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

// Validate a YYYY-MM-DD date string; return '' if invalid/absent.
function safeDate(val) {
  return /^\d{4}-\d{2}-\d{2}$/.test(val || '') ? val : '';
}

// Only include date params when BOTH are valid — otherwise omit them entirely so
// preset-day calls still match the old function signature (no hard deploy ordering).
function range(req) {
  const start_date = safeDate(req.query.start);
  const end_date   = safeDate(req.query.end);
  return (start_date && end_date) ? { start_date, end_date } : {};
}

router.get('/overview', async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('analytics_overview', {
      days_back: safeDays(req.query.days), ...range(req)
    });
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/pages', async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('analytics_pages', {
      days_back:   safeDays(req.query.days),
      search_term: (req.query.search || '').trim().slice(0, 100),
      ...range(req)
    });
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/trend', async (req, res) => {
  try {
    const r = range(req);
    const { data, error } = await supabase.rpc('analytics_trend', {
      days_back: (r.start_date && r.end_date) ? 0 : (safeDays(req.query.days) || 30), ...r
    });
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/recent', async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('analytics_recent', {
      days_back:   safeDays(req.query.days),
      page_filter: (req.query.page || '').trim().slice(0, 200),
      ...range(req)
    });
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/referrers', async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('analytics_referrers', {
      days_back: safeDays(req.query.days), ...range(req)
    });
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/funnel', async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('analytics_funnel', {
      days_back: safeDays(req.query.days), ...range(req)
    });
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// UTM tracking — parse utm_* params from tracked URLs and aggregate by source/medium/campaign.
router.get('/utm', async (req, res) => {
  try {
    const r = range(req);
    let q = supabase.from('page_views').select('page_url, page_path, visitor_id, created_at')
      .ilike('page_url', '%utm_%').order('created_at', { ascending: false }).range(0, 7999);
    if (r.start_date && r.end_date) q = q.gte('created_at', r.start_date).lte('created_at', r.end_date + 'T23:59:59');
    else { const days = safeDays(req.query.days); if (days > 0) q = q.gte('created_at', new Date(Date.now() - days * 86400000).toISOString()); }
    const { data, error } = await q;
    if (error) throw error;

    const getp = (url, k) => { const m = String(url).match(new RegExp('[?&]' + k + '=([^&#]*)', 'i')); return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : ''; };
    const combo = {}, bySource = {}; let total = 0; const uniqAll = new Set();
    for (const row of data || []) {
      if (/^\/complete(\/|$)/i.test(row.page_path || '')) continue;     // skip confirmation pages
      const src = getp(row.page_url, 'utm_source'), med = getp(row.page_url, 'utm_medium'), camp = getp(row.page_url, 'utm_campaign');
      if (!src && !med && !camp) continue;                              // require at least one utm
      const s = src || '(none)', m = med || '(none)', c = camp || '(none)';
      total++; uniqAll.add(row.visitor_id);
      const key = s + '|' + m + '|' + c;
      if (!combo[key]) combo[key] = { source: s, medium: m, campaign: c, views: 0, uniq: new Set(), lastSeen: row.created_at };
      combo[key].views++; combo[key].uniq.add(row.visitor_id);
      if (row.created_at > combo[key].lastSeen) combo[key].lastSeen = row.created_at;
      if (!bySource[s]) bySource[s] = { source: s, views: 0, uniq: new Set() };
      bySource[s].views++; bySource[s].uniq.add(row.visitor_id);
    }
    const rows = Object.values(combo).map(c => ({ source: c.source, medium: c.medium, campaign: c.campaign, views: c.views, unique: c.uniq.size, lastSeen: c.lastSeen })).sort((a, b) => b.views - a.views);
    const sources = Object.values(bySource).map(s => ({ source: s.source, views: s.views, unique: s.uniq.size })).sort((a, b) => b.views - a.views);
    res.json({ total, unique: uniqAll.size, distinctSources: sources.length, distinctCampaigns: new Set(rows.map(r => r.campaign).filter(c => c !== '(none)')).size, sources, rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
