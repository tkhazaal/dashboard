const express  = require('express');
const router   = express.Router();
const supabase = require('../database');

// Capture the raw body for ANY content-type (sendBeacon sends text/plain).
router.use(express.text({ type: '*/*', limit: '16kb' }));

// 1x1 transparent GIF for the image-pixel fallback
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function getPayload(req) {
  // GET pixel: data is in ?d=<json>
  if (req.method === 'GET' && req.query.d) {
    try { return JSON.parse(req.query.d); } catch { return {}; }
  }
  // POST: body may be a JSON string (text/plain) or already-parsed object
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  return b && typeof b === 'object' ? b : {};
}

async function handle(req, res, respond) {
  try {
    const ip   = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
    const body = getPayload(req);

    if (!body.url || !body.visitorId) return respond(400);

    let parsed;
    try { parsed = new URL(body.url); } catch { return respond(400); }

    const { error } = await supabase.from('page_views').insert({
      page_url:   String(body.url).slice(0, 500),
      page_path:  parsed.pathname.slice(0, 300),
      page_title: String(body.title     || '').slice(0, 300),
      visitor_id: String(body.visitorId || '').slice(0, 64),
      session_id: String(body.sessionId || '').slice(0, 64),
      referrer:   String(body.referrer  || '').slice(0, 500),
      user_agent: (req.headers['user-agent'] || '').slice(0, 500),
      ip_address: ip.slice(0, 45),
      screen_res: String(body.screen || '').slice(0, 20),
      timezone:   String(body.tz     || '').slice(0, 60),
    });

    if (error) throw error;
    respond(204);
  } catch (err) {
    console.error('Track error:', err.message);
    respond(500);
  }
}

// POST beacon (text/plain or json)
router.post('/', (req, res) => handle(req, res, (code) => res.status(code).send()));

// GET image-pixel fallback — always returns the gif so the <img> never errors
router.get('/', (req, res) => handle(req, res, () => {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.end(PIXEL);
}));

module.exports = router;
