require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const db      = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Serve the embeddable tracking script
app.get('/t.js', async (req, res) => {
  let baseUrl = `http://localhost:${PORT}`;
  try {
    const { data } = await db.from('settings').select('value').eq('key', 'tracker_url').single();
    if (data?.value) baseUrl = data.value;
  } catch (e) { /* fall back to default */ }
  baseUrl = baseUrl.replace(/\/+$/, ''); // strip trailing slashes

  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=300');

  res.send(`
(function(){
  'use strict';
  try {
    // Ignore page-builder / preview hosts — these are edit & preview sessions, not real visitors.
    var blocked=['leadconnectorhq','vibepreview.com','storege.io','clickfunnels.com'];
    var host=(location.hostname||'').toLowerCase();
    for(var bi=0;bi<blocked.length;bi++){ if(host.indexOf(blocked[bi])>-1) return; }
    var vid = localStorage.getItem('_mtd_vid');
    if(!vid){ vid='v_'+Math.random().toString(36).substr(2,9)+Date.now().toString(36); localStorage.setItem('_mtd_vid',vid); }
    var sid = sessionStorage.getItem('_mtd_sid');
    if(!sid){ sid='s_'+Math.random().toString(36).substr(2,9)+Date.now().toString(36); sessionStorage.setItem('_mtd_sid',sid); }
    var d={url:window.location.href,path:window.location.pathname,title:document.title,referrer:document.referrer,visitorId:vid,sessionId:sid,screen:window.screen.width+'x'+window.screen.height,tz:(Intl&&Intl.DateTimeFormat)?Intl.DateTimeFormat().resolvedOptions().timeZone:''};
    var ep='${baseUrl}/track';
    var pl=JSON.stringify(d);
    // 1) sendBeacon with text/plain — CORS-safelisted, no preflight, works cross-site
    var sent=false;
    try { if(navigator.sendBeacon){ sent=navigator.sendBeacon(ep, new Blob([pl],{type:'text/plain;charset=UTF-8'})); } } catch(e){}
    // 2) Image-pixel GET fallback — most resilient to mobile tracking prevention
    if(!sent){ try { (new Image()).src = ep + '?d=' + encodeURIComponent(pl) + '&_=' + Date.now(); } catch(e){} }
  } catch(e){}
})();
`.trim());
});

// API routes
const samcartRouter = require('./routes/samcart');
app.use('/track',          require('./routes/track'));
app.use('/api/analytics',  require('./routes/analytics'));
app.use('/api/samcart',    samcartRouter);
app.use('/api/kajabi',     require('./routes/kajabi'));
app.use('/api/ac',         require('./routes/activecampaign'));
app.use('/api/instagram',  require('./routes/instagram'));
app.use('/api/refunds',    require('./routes/refunds'));
const forms = require('./routes/forms');
app.use('/api/forms',      forms.router);
// Public webhook receiver — accept any content-type (JSON already parsed globally;
// express.text catches text/plain etc.; body-parser skips if already parsed).
app.use('/hook',           express.text({ type: () => true, limit: '2mb' }), forms.hook);
app.use('/api/settings',   require('./routes/settings'));

// Dashboard UI
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  Metric Tracking Dashboard`);
  console.log(`  http://localhost:${PORT}\n`);
  if (samcartRouter.startAutoSync) samcartRouter.startAutoSync();
});
