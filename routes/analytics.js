const express  = require('express');
const router   = express.Router();
const supabase = require('../database');

function safeDays(val) {
  const n = parseInt(val, 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

router.get('/overview', async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('analytics_overview', {
      days_back: safeDays(req.query.days)
    });
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/pages', async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('analytics_pages', {
      days_back:   safeDays(req.query.days),
      search_term: (req.query.search || '').trim().slice(0, 100)
    });
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/trend', async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('analytics_trend', {
      days_back: safeDays(req.query.days) || 30
    });
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/recent', async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('analytics_recent', {
      days_back:   safeDays(req.query.days),
      page_filter: (req.query.page || '').trim().slice(0, 200)
    });
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/referrers', async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('analytics_referrers', {
      days_back: safeDays(req.query.days)
    });
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
