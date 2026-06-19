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

module.exports = router;
