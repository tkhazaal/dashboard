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
app.get('/t.js', (req, res) => {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'tracker_url'`).get();
  const baseUrl = row?.value || `http://localhost:${PORT}`;

  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  res.send(`
(function(){
  'use strict';
  try {
    var vid = localStorage.getItem('_mtd_vid');
    if(!vid){ vid='v_'+Math.random().toString(36).substr(2,9)+Date.now().toString(36); localStorage.setItem('_mtd_vid',vid); }
    var sid = sessionStorage.getItem('_mtd_sid');
    if(!sid){ sid='s_'+Math.random().toString(36).substr(2,9)+Date.now().toString(36); sessionStorage.setItem('_mtd_sid',sid); }
    var d={url:window.location.href,path:window.location.pathname,title:document.title,referrer:document.referrer,visitorId:vid,sessionId:sid,screen:window.screen.width+'x'+window.screen.height,tz:(Intl&&Intl.DateTimeFormat)?Intl.DateTimeFormat().resolvedOptions().timeZone:''};
    var ep='${baseUrl}/track';
    var pl=JSON.stringify(d);
    if(navigator.sendBeacon){ var b=new Blob([pl],{type:'application/json'}); navigator.sendBeacon(ep,b); }
    else{ var x=new XMLHttpRequest(); x.open('POST',ep,true); x.setRequestHeader('Content-Type','application/json'); x.send(pl); }
  } catch(e){}
})();
`.trim());
});

// API routes
app.use('/track',          require('./routes/track'));
app.use('/api/analytics',  require('./routes/analytics'));
app.use('/api/samcart',    require('./routes/samcart'));
app.use('/api/settings',   require('./routes/settings'));

// Dashboard UI
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  Metric Tracking Dashboard`);
  console.log(`  http://localhost:${PORT}\n`);
});
