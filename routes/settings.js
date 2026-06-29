const express  = require('express');
const router   = express.Router();
const supabase = require('../database');

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('settings').select('key, value');
    if (error) throw error;

    const s = Object.fromEntries(data.map(r => [r.key, r.value]));
    const mask = k => k.slice(0, 6) + '•'.repeat(Math.max(0, k.length - 10)) + k.slice(-4);
    if (s.samcart_api_key)      { s.samcart_api_key_masked = mask(s.samcart_api_key); delete s.samcart_api_key; }
    if (s.kajabi_client_secret) { s.kajabi_client_secret_masked = mask(s.kajabi_client_secret); delete s.kajabi_client_secret; }
    if (s.ac_api_token)         { s.ac_api_token_masked = mask(s.ac_api_token); delete s.ac_api_token; }
    if (s.apify_token)          { s.apify_token_masked = mask(s.apify_token); delete s.apify_token; }
    // Client ID is half a credential — show masked, never raw. (URL isn't secret.)
    if (s.kajabi_client_id)     { s.kajabi_client_id_masked = mask(s.kajabi_client_id); delete s.kajabi_client_id; }
    res.json(s);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const allowed = ['site_name', 'tracker_url', 'samcart_api_key', 'monthly_goal', 'funnels_config', 'ad_campaigns', 'kajabi_client_id', 'kajabi_client_secret', 'ac_api_url', 'ac_api_token', 'apify_token', 'apify_actor_id', 'instagram_username', 'apify_fb_actor_id', 'facebook_page_url'];
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
