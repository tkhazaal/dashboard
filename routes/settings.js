const express  = require('express');
const router   = express.Router();
const supabase = require('../database');

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('settings').select('key, value');
    if (error) throw error;

    const s = Object.fromEntries(data.map(r => [r.key, r.value]));
    if (s.samcart_api_key) {
      const k = s.samcart_api_key;
      s.samcart_api_key_masked = k.slice(0, 6) + '•'.repeat(Math.max(0, k.length - 10)) + k.slice(-4);
      delete s.samcart_api_key;
    }
    res.json(s);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const allowed = ['site_name', 'tracker_url', 'samcart_api_key', 'monthly_goal', 'funnels_config'];
    const updates = [];

    for (const key of allowed) {
      const val = req.body[key];
      if (val !== undefined && val !== '') {
        const { error } = await supabase.from('settings').upsert(
          { key, value: String(val), updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        );
        if (error) throw error;
        updates.push(key);
      }
    }

    if (updates.includes('samcart_api_key')) {
      await supabase.from('samcart_cache').delete().neq('cache_key', '');
    }

    res.json({ success: true, updated: updates });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
