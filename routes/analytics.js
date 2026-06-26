const express  = require('express');
const router   = express.Router();
const supabase = require('../database');

function safeDays(val) {
  const n = parseInt(val, 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

// Supabase/PostgREST caps every response at max-rows (1000 here), so .range(0, 49999)
// silently returns only the newest 1000 rows — truncating large result sets. Page
// through .range() until a short page comes back to fetch the full set.
async function fetchAllPages(buildQuery, pageSize = 1000, maxRows = 200000) {
  const all = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}

// Validate a YYYY-MM-DD date string; return '' if invalid/absent.
function safeDate(val) {
  return /^\d{4}-\d{2}-\d{2}$/.test(val || '') ? val : '';
}

// The UTC instant that corresponds to the start (or end) of a calendar day in
// Eastern Time, so created_at filtering buckets on EST like the SQL functions do.
// (DST-aware and independent of the server's own timezone.)
const ET_TZ = 'America/New_York';
function etBoundUTC(dateStr, endOfDay) {
  const [Y, M, D] = dateStr.split('-').map(Number);
  const guess  = Date.UTC(Y, M - 1, D, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  const asET   = new Date(new Date(guess).toLocaleString('en-US', { timeZone: ET_TZ }));
  const asUTC  = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess + (asUTC - asET)).toISOString();
}

// Only include date params when BOTH are valid — otherwise omit them entirely so
// preset-day calls still match the old function signature (no hard deploy ordering).
function range(req) {
  const start_date = safeDate(req.query.start);
  const end_date   = safeDate(req.query.end);
  return (start_date && end_date) ? { start_date, end_date } : {};
}

const { utmChannel } = require('../channel');   // shared UTM → channel resolver
const { cleanProduct, productFromUrl } = require('../product');   // checkout slug → product family
const isCheckoutUrl = u => /samcart/i.test(u) || /\/products?(\/|\?|$)/i.test(u);
// A purchase-confirmation / thank-you page (our pixel placed there marks a completed sale).
// Excludes funnel-builder "preview" pages, which aren't real purchases.
const isConfirmationUrl = u => {
  const s = String(u);
  if (/preview/i.test(s)) return false;
  return /thank|confirm|order[-_]?received|order[-_]?success|purchase[-_]?complete|\/complete\/|receipt/i.test(s);
};

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
    const buildUtmQuery = () => {
      let q = supabase.from('page_views').select('page_url, page_path, visitor_id, created_at')
        .ilike('page_url', '%utm_%').order('created_at', { ascending: false });
      if (r.start_date && r.end_date) q = q.gte('created_at', etBoundUTC(r.start_date, false)).lte('created_at', etBoundUTC(r.end_date, true));
      else { const days = safeDays(req.query.days); if (days > 0) q = q.gte('created_at', new Date(Date.now() - days * 86400000).toISOString()); }
      return q;
    };
    const data = await fetchAllPages(buildUtmQuery);   // fetch ALL utm views, not just the newest 1000

    const getp = (url, k) => { const m = String(url).match(new RegExp('[?&]' + k + '=([^&#]*)', 'i')); return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')).trim() : ''; };
    const combo = {}, bySource = {}, byChannel = {}; let total = 0; const uniqAll = new Set();
    const visitorChannel = {}, visitorCombo = {};   // each visitor's most-recent UTM channel/combo (for order attribution)
    const campChan = {};   // 'campaign + SEP + channel' -> true views/unique/checkout (breakdown header)
    const chProd = {};   // 'campaignchannelproduct' -> checkout views/unique (for the Channel × Product breakdown)
    for (const row of data || []) {
      if (/^\/complete(\/|$)/i.test(row.page_path || '')) continue;     // skip confirmation pages
      const src = getp(row.page_url, 'utm_source'), med = getp(row.page_url, 'utm_medium'),
            camp = getp(row.page_url, 'utm_campaign'), cont = getp(row.page_url, 'utm_content'), term = getp(row.page_url, 'utm_term');
      if (!src && !med && !camp && !cont) continue;                     // require at least one utm
      const s = src || '(none)', m = med || '(none)', c = camp || '(none)', ct = cont || '(none)';
      const channel = utmChannel(cont, src, med);
      const checkout = isCheckoutUrl(row.page_url);
      total++; uniqAll.add(row.visitor_id);
      const key = s + '|' + m + '|' + c + '|' + ct;
      if (!visitorChannel[row.visitor_id]) { visitorChannel[row.visitor_id] = channel; visitorCombo[row.visitor_id] = key; }
      if (!combo[key]) combo[key] = { source: s, medium: m, campaign: c, content: ct, channel, views: 0, uniq: new Set(), coViews: 0, lastSeen: row.created_at };
      if (checkout) combo[key].coViews++; else { combo[key].views++; combo[key].uniq.add(row.visitor_id); }
      if (row.created_at > combo[key].lastSeen) combo[key].lastSeen = row.created_at;
      if (!bySource[s]) bySource[s] = { source: s, views: 0, uniq: new Set() };
      bySource[s].views++; bySource[s].uniq.add(row.visitor_id);
      if (!byChannel[channel]) byChannel[channel] = { channel, views: 0, uniq: new Set(), coViews: 0, coUniq: new Set(), camps: new Set(), lastSeen: row.created_at };
      const bc = byChannel[channel];
      if (checkout) { bc.coViews++; bc.coUniq.add(row.visitor_id); } else { bc.views++; bc.uniq.add(row.visitor_id); }
      if (c !== '(none)') bc.camps.add(c);
      if (row.created_at > bc.lastSeen) bc.lastSeen = row.created_at;

      // Per campaign × channel — true unique reach (dedups visitors across content combos)
      const cck = `${c}${channel}`;
      if (!campChan[cck]) campChan[cck] = { campaign: c, channel, views: 0, uniq: new Set(), checkout: 0 };
      const ccc = campChan[cck];
      ccc.uniq.add(row.visitor_id);
      if (checkout) ccc.checkout++; else ccc.views++;

      // Checkout views by campaign × channel × product (product from the checkout slug)
      if (checkout) {
        const prod = productFromUrl(row.page_url) || 'Other';
        const cpk = `${c}${channel}${prod}`;
        if (!chProd[cpk]) chProd[cpk] = { campaign: c, channel, product: prod, checkoutViews: 0, uniq: new Set() };
        chProd[cpk].checkoutViews++; chProd[cpk].uniq.add(row.visitor_id);
      }
    }
    // ── Orders = purchase-confirmation / thank-you page views (our pixel on the
    // post-checkout page). Each is attributed to a channel via the page's own UTM,
    // else the visitor's most-recent UTM visit. One order per visitor (dedupe refreshes).
    const ordersByCh = {}, ordersByCombo = {}; let totalOrders = 0;
    try {
      const buildConfQuery = () => {
        let cq = supabase.from('page_views').select('page_url, page_path, visitor_id, created_at')
          .or('page_url.ilike.*thank*,page_url.ilike.*confirm*,page_url.ilike.*/complete/*,page_url.ilike.*receipt*,page_url.ilike.*order-received*,page_url.ilike.*order-success*,page_url.ilike.*order_received*')
          .order('created_at', { ascending: false });
        if (r.start_date && r.end_date) cq = cq.gte('created_at', etBoundUTC(r.start_date, false)).lte('created_at', etBoundUTC(r.end_date, true));
        else { const days = safeDays(req.query.days); if (days > 0) cq = cq.gte('created_at', new Date(Date.now() - days * 86400000).toISOString()); }
        return cq;
      };
      const confs = await fetchAllPages(buildConfQuery);
      const seen = new Set();
      for (const cv of (confs || [])) {
        if (!isConfirmationUrl(cv.page_url)) continue;
        if (seen.has(cv.visitor_id)) continue;            // one order per visitor
        const oc = getp(cv.page_url, 'utm_content'), os = getp(cv.page_url, 'utm_source'),
              om = getp(cv.page_url, 'utm_medium'), ocamp = getp(cv.page_url, 'utm_campaign');
        let ch, ck;
        if (oc || os || ocamp) { ch = utmChannel(oc, os, om); ck = `${os || '(none)'}|${om || '(none)'}|${ocamp || '(none)'}|${oc || '(none)'}`; }
        else if (visitorChannel[cv.visitor_id]) { ch = visitorChannel[cv.visitor_id]; ck = visitorCombo[cv.visitor_id]; }
        else continue;                                    // can't attribute → skip
        seen.add(cv.visitor_id);
        ordersByCh[ch] = (ordersByCh[ch] || 0) + 1;
        if (ck) ordersByCombo[ck] = (ordersByCombo[ck] || 0) + 1;
        totalOrders++;
      }
    } catch (e) { /* order attribution is best-effort */ }

    const rows = Object.values(combo).map(c => ({ source: c.source, medium: c.medium, campaign: c.campaign, content: c.content, channel: c.channel, views: c.views, unique: c.uniq.size, checkoutViews: c.coViews, orders: ordersByCombo[`${c.source}|${c.medium}|${c.campaign}|${c.content}`] || 0, lastSeen: c.lastSeen })).sort((a, b) => (b.views + b.checkoutViews) - (a.views + a.checkoutViews));
    const sources = Object.values(bySource).map(s => ({ source: s.source, views: s.views, unique: s.uniq.size })).sort((a, b) => b.views - a.views);
    const channels = Object.values(byChannel).map(c => ({ channel: c.channel, views: c.views, unique: c.uniq.size, checkoutViews: c.coViews, checkoutUnique: c.coUniq.size, campaigns: c.camps.size, orders: ordersByCh[c.channel] || 0, lastSeen: c.lastSeen })).sort((a, b) => (b.views + b.checkoutViews) - (a.views + a.checkoutViews));
    const channelProducts = Object.values(chProd).map(c => ({
      campaign: c.campaign, channel: c.channel, product: c.product,
      checkoutViews: c.checkoutViews, checkoutUnique: c.uniq.size,
    })).sort((a, b) => b.checkoutViews - a.checkoutViews);
    const campaignChannels = Object.values(campChan).map(c => ({
      campaign: c.campaign, channel: c.channel, views: c.views, unique: c.uniq.size, checkout: c.checkout,
    }));
    res.json({
      total, unique: uniqAll.size, totalOrders,
      distinctSources: sources.length, distinctChannels: channels.length,
      distinctCampaigns: new Set(rows.map(r => r.campaign).filter(c => c !== '(none)')).size,
      channels, sources, rows, channelProducts, campaignChannels,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
