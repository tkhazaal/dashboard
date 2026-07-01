const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const supabase = require('../database');

// Click-tracking redirect. Wrap an outbound link (e.g. to skool.com) as:
//   https://<dashboard>/go?to=<url-encoded destination, incl. utm_* params>
// We log the click as a page_view (so the UTM section picks it up automatically),
// then 302 to the real destination. Works even when the destination can't host the
// tracking snippet (Skool, Calendly, external communities, etc.).
router.get('/', (req, res) => {
  const dest = req.query.to || req.query.url || req.query.u || '';
  let target;
  try { target = new URL(dest); } catch { return res.status(400).send('Missing or invalid ?to= destination URL'); }
  if (!/^https?:$/.test(target.protocol)) return res.status(400).send('Only http/https destinations allowed');

  // Merge any utm_* passed on the /go link itself onto the destination (so they get logged & forwarded).
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    if (req.query[k]) target.searchParams.set(k, String(req.query[k]));
  }

  // Stable-ish visitor id via cookie (so unique clicks are counted sensibly).
  const m = (req.headers.cookie || '').match(/_mtd_vid=([^;]+)/);
  const vid = m ? m[1] : crypto.randomBytes(12).toString('hex');
  res.setHeader('Set-Cookie', `_mtd_vid=${vid}; Max-Age=31536000; Path=/; SameSite=Lax`);

  // Fire-and-forget log (never block or fail the redirect on a DB hiccup).
  supabase.from('page_views').insert({
    page_url:   target.href.slice(0, 500),                 // has utm_* → UTM section extracts it
    page_path:  ('/go' + (target.pathname || '/')).slice(0, 300),
    page_title: ('link click → ' + target.hostname).slice(0, 300),
    visitor_id: vid.slice(0, 64),
    session_id: vid.slice(0, 64),
    referrer:   String(req.headers.referer || '').slice(0, 500),
    user_agent: String(req.headers['user-agent'] || '').slice(0, 500),
    ip_address: ((req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '').slice(0, 45),
  }).then(() => {}).catch(err => console.error('go/click log:', err.message));

  res.redirect(302, target.href);
});

module.exports = router;
