const express  = require('express');
const router   = express.Router();
const supabase = require('../database');

// SamCart timestamps are naive store-local ("YYYY-MM-DD HH:MM:SS"); Kajabi are ISO
// with an offset. For day filtering, take the literal date for naive strings and
// convert tz-aware ones to Eastern.
const dayOf = ts => {
  const s = String(ts || '');
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return s.slice(0, 10);
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(s)); }
  catch { return s.slice(0, 10); }
};

async function readCache(key) {
  try {
    const { data } = await supabase.from('samcart_cache').select('data').eq('cache_key', key).single();
    return data && data.data ? JSON.parse(data.data) : null;
  } catch { return null; }
}
const round = n => Math.round(n * 100) / 100;

// GET /api/refunds?start_date=&end_date=&source=&product=
router.get('/', async (req, res) => {
  try {
    const [sc, kj, reasonsRes] = await Promise.all([
      readCache('samcart_metrics'),
      readCache('kajabi_metrics'),
      supabase.from('refund_reasons').select('refund_key, reason, note'),
    ]);
    // refund_reasons table is optional — if it's not created yet, still show the
    // refunds list (all "Untagged") and flag it so the UI can prompt to run the SQL.
    const reasonsTableMissing = !!(reasonsRes && reasonsRes.error);
    const reasonMap = {};
    if (!reasonsTableMissing) for (const r of (reasonsRes.data || [])) reasonMap[r.refund_key] = r;

    let list = [...((sc && sc.refunds) || []), ...((kj && kj.refunds) || [])]
      .map(r => ({ ...r, reason: (reasonMap[r.id] || {}).reason || '', note: (reasonMap[r.id] || {}).note || '' }));

    const { source, product } = req.query;
    const sd = /^\d{4}-\d{2}-\d{2}$/.test(req.query.start_date || '') ? req.query.start_date : '';
    const ed = /^\d{4}-\d{2}-\d{2}$/.test(req.query.end_date || '') ? req.query.end_date : '';
    // date + source filter first — the product dropdown universe is built from this,
    // so picking one product doesn't hide the others from the dropdown.
    list = list.filter(r => {
      const d = dayOf(r.date);
      if (sd && d < sd) return false;
      if (ed && d > ed) return false;
      if (source && r.source !== source) return false;
      return true;
    });
    const products = [...new Set(list.map(r => r.product || 'Unknown'))].sort();
    if (product) list = list.filter(r => (r.product || 'Unknown') === product);
    // normalise the separator so naive SamCart (space) and ISO Kajabi (T) sort together
    const sortKey = s => String(s).replace(' ', 'T');
    list.sort((a, b) => sortKey(b.date).localeCompare(sortKey(a.date)));

    const bySource = {}, byProduct = {}, byReason = {};
    let total = 0;
    for (const r of list) {
      total += r.amount;
      bySource[r.source] = (bySource[r.source] || 0) + r.amount;
      byProduct[r.product || 'Unknown'] = (byProduct[r.product || 'Unknown'] || 0) + r.amount;
      const rk = r.reason || 'Untagged';
      (byReason[rk] = byReason[rk] || { amount: 0, count: 0 }).amount += r.amount;
      byReason[rk].count++;
    }
    res.json({
      refunds: list,
      summary: {
        total: round(total),
        count: list.length,
        untagged: list.filter(r => !r.reason).length,
        bySource: Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, round(v)])),
      },
      byReason: Object.entries(byReason).map(([reason, v]) => ({ reason, amount: round(v.amount), count: v.count })).sort((a, b) => b.amount - a.amount),
      byProduct: Object.entries(byProduct).map(([product, amount]) => ({ product, amount: round(amount) })).sort((a, b) => b.amount - a.amount),
      products,
      synced: (sc && sc.syncedAt) || null,
      reasonsTableMissing,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/refunds/reason  { key, reason, note? } — tag why a refund happened.
router.post('/reason', async (req, res) => {
  try {
    const refund_key = (req.body.key || '').toString();
    if (!refund_key) return res.status(400).json({ error: 'key required' });
    const reason = (req.body.reason || '').toString().slice(0, 200);
    const note = (req.body.note || '').toString().slice(0, 1000);
    const { error } = await supabase.from('refund_reasons').upsert(
      { refund_key, source: refund_key.split(':')[0], reason, note, updated_at: new Date().toISOString() },
      { onConflict: 'refund_key' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
