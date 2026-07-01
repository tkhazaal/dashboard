const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const fetch    = require('node-fetch');
const supabase = require('../database');

// ── Webhook token (stored in settings, shown in the UI so it can be pasted into ManyChat) ──
async function getToken() {
  const { data } = await supabase.from('settings').select('value').eq('key', 'manychat_token').maybeSingle();
  if (data && data.value) return data.value;
  const tok = crypto.randomBytes(16).toString('hex');
  await supabase.from('settings').upsert({ key: 'manychat_token', value: tok, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  return tok;
}
async function getApiKey() {
  const { data } = await supabase.from('settings').select('value').eq('key', 'manychat_api_key').maybeSingle();
  return (data && data.value) || '';
}

const str = (v, n = 200) => (v == null || v === '') ? null : String(v).slice(0, n);

// ── Public receiver — ManyChat "External Request" POSTs optins / CTA clicks here ──
// Accepts flexible field names so it works with whatever the flow sends.
router.post('/hook/:token', async (req, res) => {
  try {
    if (req.params.token !== await getToken()) return res.status(403).json({ ok: false, error: 'bad token' });
    const b = (req.body && typeof req.body === 'object') ? req.body : {};
    const gt = (b.last_growth_tool && typeof b.last_growth_tool === 'object') ? b.last_growth_tool : {};
    const cf = (b.custom_fields && typeof b.custom_fields === 'object') ? b.custom_fields : {};
    // event can come from the body (?) or — simplest for ManyChat's fragile Body editor — the URL itself,
    // e.g. …/hook/<token>?event=cta_click, so two External Requests with an identical body still differ.
    const event = String(req.query.event || b.event || b.type || 'optin').toLowerCase() === 'cta_click' ? 'cta_click' : 'optin';
    const row = {
      ref: str(b.ref || b.cta || b.tag, 200),
      post_url: str(b.post_url || b.post_link || b.link || b.url || b.permalink, 600),
      growth_tool_id: str(b.growth_tool_id || gt.id || gt.key, 80),
      growth_tool_name: str(b.growth_tool_name || gt.name, 200),
      // The keyword that matched — ManyChat doesn't expose this after the fact, so it must be
      // sent explicitly (set a Custom Field at the matching branch in the flow, then include it here).
      keyword: str(b.keyword || b.matched_keyword || cf.matched_keyword, 200),
      event,
      subscriber_id: str(b.subscriber_id || b.user_id || b.id, 120),
      name: str(b.name || b.full_name || [b.first_name, b.last_name].filter(Boolean).join(' '), 160),
      channel: str(b.channel || b.platform || b.source || gt.channel, 40),
      raw: b,
    };
    const { error } = await supabase.from('manychat_optins').insert(row);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { res.status(200).json({ ok: false, error: e.message }); }   // 200 so ManyChat doesn't retry-storm
});

// ── ManyChat Growth Tools list (via API) — so the dashboard can show real names
// instead of raw ids, and offer them as autocomplete when mapping a post. ──
let _gtCache = { at: 0, data: null };
async function fetchGrowthTools(apiKey) {
  const r = await fetch('https://api.manychat.com/fb/page/getGrowthTools', { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 20000 });
  const j = await r.json();
  if (j.status !== 'success') throw new Error(j.message || 'ManyChat API error');
  return (j.data || []).map(t => ({ id: String(t.id), name: t.name, type: t.type }));
}
router.get('/growth-tools', async (req, res) => {
  try {
    const key = await getApiKey();
    if (!key) return res.json({ configured: false, tools: [] });
    if (_gtCache.data && (Date.now() - _gtCache.at) < 10 * 60 * 1000 && req.query.force !== '1') return res.json({ configured: true, tools: _gtCache.data, fromCache: true });
    const tools = await fetchGrowthTools(key);
    _gtCache = { at: Date.now(), data: tools };
    res.json({ configured: true, tools });
  } catch (e) { res.json({ configured: false, tools: _gtCache.data || [], error: e.message }); }
});

// ── Aggregated data for the dashboard ──
router.get('/data', async (req, res) => {
  let token = '';
  try { token = await getToken(); } catch {}
  try {
    const { data, error } = await supabase.from('manychat_optins')
      .select('ref, post_url, growth_tool_id, growth_tool_name, keyword, event, channel, name, subscriber_id, created_at')
      .order('created_at', { ascending: false }).limit(20000);
    if (error) throw error;
    const rows = data || [];
    const refMap = {}, byChannel = {}, byPostUrl = {}, gtMap = {}, keywordMap = {};
    let optins = 0, ctaClicks = 0;
    const bump = (bag, key, field, isCta, at, extra) => {
      const m = bag[key] || (bag[key] = { [field]: key, optins: 0, cta_clicks: 0, lastAt: null, ...extra });
      if (isCta) m.cta_clicks++; else m.optins++;
      if (!m.lastAt || at > m.lastAt) m.lastAt = at;
      return m;
    };
    for (const r of rows) {
      const isCta = r.event === 'cta_click';
      if (isCta) ctaClicks++; else optins++;
      if (r.ref) bump(refMap, r.ref, 'ref', isCta, r.created_at);
      if (r.post_url) bump(byPostUrl, r.post_url, 'post_url', isCta, r.created_at);
      if (r.growth_tool_id || r.growth_tool_name) {
        const key = String(r.growth_tool_id || r.growth_tool_name);
        const m = bump(gtMap, key, 'growth_tool_id', isCta, r.created_at, { name: r.growth_tool_name || null });
        if (r.growth_tool_name && !m.name) m.name = r.growth_tool_name;
      }
      if (r.keyword) bump(keywordMap, r.keyword, 'keyword', isCta, r.created_at);
      const ch = r.channel || 'unknown';
      const c = byChannel[ch] || (byChannel[ch] = { channel: ch, optins: 0 });
      if (!isCta) c.optins++;
    }
    // Backfill growth-tool names from the cached API list when a webhook only sent the id.
    if (_gtCache.data) {
      const byId = Object.fromEntries(_gtCache.data.map(t => [t.id, t]));
      for (const k in gtMap) { if (!gtMap[k].name && byId[k]) { gtMap[k].name = byId[k].name; gtMap[k].type = byId[k].type; } else if (byId[k]) gtMap[k].type = byId[k].type; }
    }
    const recent = rows.slice(0, 60).map(r => ({ name: r.name, growth_tool_name: r.growth_tool_name, channel: r.channel, keyword: r.keyword, event: r.event, created_at: r.created_at }));
    res.json({
      configured: true, token,
      totals: { optins, ctaClicks, total: rows.length },
      byRef: Object.values(refMap).sort((a, b) => b.optins - a.optins),
      byGrowthTool: Object.values(gtMap).sort((a, b) => b.optins - a.optins),
      byChannel: Object.values(byChannel).sort((a, b) => b.optins - a.optins),
      byKeyword: Object.values(keywordMap).sort((a, b) => b.optins - a.optins),
      recent,
      refMap, byPostUrl, gtMap,
    });
  } catch (e) { res.json({ configured: false, token, error: e.message }); }
});

router.get('/token', async (req, res) => { try { res.json({ token: await getToken() }); } catch (e) { res.json({ error: e.message }); } });

module.exports = router;
