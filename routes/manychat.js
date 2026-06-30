const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const supabase = require('../database');

// ── Webhook token (stored in settings, shown in the UI so it can be pasted into ManyChat) ──
async function getToken() {
  const { data } = await supabase.from('settings').select('value').eq('key', 'manychat_token').maybeSingle();
  if (data && data.value) return data.value;
  const tok = crypto.randomBytes(16).toString('hex');
  await supabase.from('settings').upsert({ key: 'manychat_token', value: tok, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  return tok;
}

const str = (v, n = 200) => (v == null || v === '') ? null : String(v).slice(0, n);

// ── Public receiver — ManyChat "External Request" POSTs optins / CTA clicks here ──
// Accepts flexible field names so it works with whatever the flow sends.
router.post('/hook/:token', async (req, res) => {
  try {
    if (req.params.token !== await getToken()) return res.status(403).json({ ok: false, error: 'bad token' });
    const b = (req.body && typeof req.body === 'object') ? req.body : {};
    const event = String(b.event || b.type || 'optin').toLowerCase() === 'cta_click' ? 'cta_click' : 'optin';
    const row = {
      ref: str(b.ref || b.cta || b.tag, 200),
      post_url: str(b.post_url || b.post_link || b.link || b.url || b.permalink, 600),
      event,
      subscriber_id: str(b.subscriber_id || b.user_id || b.id, 120),
      name: str(b.name || b.first_name || b.full_name, 160),
      channel: str(b.channel || b.platform || b.source, 40),
      raw: b,
    };
    const { error } = await supabase.from('manychat_optins').insert(row);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { res.status(200).json({ ok: false, error: e.message }); }   // 200 so ManyChat doesn't retry-storm
});

// ── Aggregated data for the dashboard ──
router.get('/data', async (req, res) => {
  let token = '';
  try { token = await getToken(); } catch {}
  try {
    const { data, error } = await supabase.from('manychat_optins')
      .select('ref, post_url, event, channel, created_at').order('created_at', { ascending: false }).limit(20000);
    if (error) throw error;
    const rows = data || [];
    const refMap = {}, byChannel = {}, byPostUrl = {};
    let optins = 0, ctaClicks = 0;
    const bump = (bag, key, field, isCta, at, extra) => {
      const m = bag[key] || (bag[key] = { [field]: key, optins: 0, cta_clicks: 0, lastAt: null, ...extra });
      if (isCta) m.cta_clicks++; else m.optins++;
      if (!m.lastAt || at > m.lastAt) m.lastAt = at;
    };
    for (const r of rows) {
      const isCta = r.event === 'cta_click';
      if (isCta) ctaClicks++; else optins++;
      if (r.ref) bump(refMap, r.ref, 'ref', isCta, r.created_at);
      if (r.post_url) bump(byPostUrl, r.post_url, 'post_url', isCta, r.created_at);
      const ch = r.channel || 'unknown';
      const c = byChannel[ch] || (byChannel[ch] = { channel: ch, optins: 0 });
      if (!isCta) c.optins++;
    }
    res.json({
      configured: true, token,
      totals: { optins, ctaClicks, total: rows.length },
      byRef: Object.values(refMap).sort((a, b) => b.optins - a.optins),
      byChannel: Object.values(byChannel).sort((a, b) => b.optins - a.optins),
      refMap, byPostUrl,
    });
  } catch (e) { res.json({ configured: false, token, error: e.message }); }
});

router.get('/token', async (req, res) => { try { res.json({ token: await getToken() }); } catch (e) { res.json({ error: e.message }); } });

module.exports = router;
