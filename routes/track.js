const express  = require('express');
const router   = express.Router();
const supabase = require('../database');

router.post('/', async (req, res) => {
  try {
    const ip   = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
    const body = req.body || {};

    if (!body.url || !body.visitorId) return res.status(400).json({ error: 'Missing required fields' });

    let parsed;
    try { parsed = new URL(body.url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }

    const { error } = await supabase.from('page_views').insert({
      page_url:   body.url.slice(0, 500),
      page_path:  parsed.pathname.slice(0, 300),
      page_title: (body.title     || '').slice(0, 300),
      visitor_id: (body.visitorId || '').slice(0, 64),
      session_id: (body.sessionId || '').slice(0, 64),
      referrer:   (body.referrer  || '').slice(0, 500),
      user_agent: (req.headers['user-agent'] || '').slice(0, 500),
      ip_address: ip.slice(0, 45),
      screen_res: (body.screen || '').slice(0, 20),
      timezone:   (body.tz     || '').slice(0, 60),
    });

    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    console.error('Track error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
