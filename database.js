// Polyfill WebSocket for Node < 22 (supabase-js v2 requires it at createClient time).
// Must run BEFORE @supabase/supabase-js is loaded.
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = require('ws');
}

const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error('\n  ERROR: SUPABASE_URL or SUPABASE_SERVICE_KEY is not set in .env\n');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

// Test connection on startup
supabase.from('settings').select('key').limit(1)
  .then(({ error }) => {
    if (error) console.error('  Database connection failed:', error.message);
    else       console.log ('  Database connected (Supabase ✓)');
  });

module.exports = supabase;
