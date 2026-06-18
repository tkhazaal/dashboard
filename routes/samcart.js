const express  = require('express');
const router   = express.Router();
const fetch    = require('node-fetch');
const supabase = require('../database');

const BASE_URL  = 'https://api.samcart.com/v1';
const CACHE_TTL = parseInt(process.env.SAMCART_CACHE_MINUTES || '60', 10) * 60 * 1000;

async function getApiKey() {
  const { data } = await supabase.from('settings').select('value').eq('key', 'samcart_api_key').single();
  return data?.value || process.env.SAMCART_API_KEY || '';
}

async function getCached(key) {
  const { data } = await supabase.from('samcart_cache').select('data, cached_at').eq('cache_key', key).single();
  if (!data) return null;
  if (Date.now() - new Date(data.cached_at).getTime() > CACHE_TTL) return null;
  try { return JSON.parse(data.data); } catch { return null; }
}

async function setCache(key, payload) {
  await supabase.from('samcart_cache').upsert(
    { cache_key: key, data: JSON.stringify(payload), cached_at: new Date().toISOString() },
    { onConflict: 'cache_key' }
  );
}

async function fetchAllPages(path, apiKey) {
  const all = [];
  let page = 1;

  while (true) {
    const url  = `${BASE_URL}${path}?per_page=100&page=${page}`;
    const resp = await fetch(url, {
      headers: { 'Authorization': apiKey, 'Accept': 'application/json' },
      timeout: 30000,
    });

    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`SamCart API ${resp.status}: ${txt.slice(0, 200)}`);
    }

    const json = await resp.json();

    if (Array.isArray(json)) { all.push(...json); break; }
    if (json.data) {
      all.push(...json.data);
      const meta = json.meta || {};
      if ((meta.current_page || page) >= (meta.last_page || 1)) break;
      page++;
    } else {
      all.push(...(Object.values(json).find(v => Array.isArray(v)) || []));
      break;
    }
    if (page > 200) break;
  }
  return all;
}

function computeMetrics(orders) {
  const custMap = new Map();

  for (const o of orders) {
    const email   = (o.customer_email || o.email || '').toLowerCase().trim();
    const name    = o.customer_name || o.full_name || `${o.first_name||''} ${o.last_name||''}`.trim() || 'Unknown';
    const amount  = parseFloat(o.total_price || o.total || o.amount || 0);
    const product = o.product_name || o.product?.name || o.item_name || 'Unknown Product';
    const date    = o.created_at || o.order_date || o.date || null;

    if (!email) continue;
    if (!custMap.has(email)) custMap.set(email, { email, name, orders: [], products: new Set(), ltv: 0 });
    const c = custMap.get(email);
    c.orders.push({ amount, product, date });
    c.products.add(product);
    c.ltv += amount;
  }

  const customers = [...custMap.values()].map(c => ({
    email: c.email, name: c.name,
    orders: c.orders.length, products: c.products.size,
    ltv: Math.round(c.ltv * 100) / 100,
    orderList: c.orders,
  }));

  const total   = customers.length;
  const revenue = customers.reduce((s, c) => s + c.ltv, 0);
  const avgLtv  = total > 0 ? revenue / total : 0;

  const sorted = [...customers].sort((a, b) => a.ltv - b.ltv);
  const mid = Math.floor(sorted.length / 2);
  const medianLtv = !sorted.length ? 0
    : sorted.length % 2 === 0 ? (sorted[mid-1].ltv + sorted[mid].ltv) / 2
    : sorted[mid].ltv;

  const repeats = customers.filter(c => c.orders > 1);
  let funnelCount = 0, ecosystemCount = 0;
  for (const c of repeats) {
    const s2 = [...c.orderList].sort((a, b) => new Date(a.date||0) - new Date(b.date||0));
    if (s2.length < 2) continue;
    const gapH = (new Date(s2[1].date||0) - new Date(s2[0].date||0)) / 3600000;
    if (gapH < 24) funnelCount++; else ecosystemCount++;
  }

  const TIERS = [
    { label: 'Under $50',   min: 0,    max: 50,      count: 0, total: 0 },
    { label: '$50 – $99',   min: 50,   max: 100,     count: 0, total: 0 },
    { label: '$100 – $199', min: 100,  max: 200,     count: 0, total: 0 },
    { label: '$200 – $499', min: 200,  max: 500,     count: 0, total: 0 },
    { label: '$500 – $999', min: 500,  max: 1000,    count: 0, total: 0 },
    { label: '$1,000+',     min: 1000, max: Infinity, count: 0, total: 0 },
  ];
  for (const c of customers) {
    const t = TIERS.find(t => c.ltv >= t.min && c.ltv < t.max);
    if (t) { t.count++; t.total += c.ltv; }
  }

  const pathMap = new Map();
  for (const c of customers) {
    const s2 = [...c.orderList].sort((a, b) => new Date(a.date||0) - new Date(b.date||0));
    if (s2.length >= 2) {
      const key = `${s2[0].product}|||${s2[1].product}`;
      pathMap.set(key, (pathMap.get(key) || 0) + 1);
    }
  }

  const productPaths = [...pathMap.entries()]
    .map(([k, count]) => { const [first, second] = k.split('|||'); return { first, second, count }; })
    .sort((a, b) => b.count - a.count).slice(0, 10);

  const topCustomers = [...customers]
    .sort((a, b) => b.ltv - a.ltv).slice(0, 20)
    .map(({ orderList, ...rest }) => rest);

  return {
    totalCustomers: total,
    totalRevenue:   Math.round(revenue * 100) / 100,
    avgLtv:         Math.round(avgLtv * 100) / 100,
    medianLtv:      Math.round(medianLtv * 100) / 100,
    repeatBuyers:   repeats.length,
    singleBuyers:   total - repeats.length,
    funnelBuyers:   funnelCount,
    ecosystemBuyers: ecosystemCount,
    tiers: TIERS, topCustomers, productPaths,
  };
}

// Demo data (used when API is unreachable)
const DEMO_DATA = {
  totalCustomers: 11698, totalRevenue: 768107, avgLtv: 65.66, medianLtv: 27,
  repeatBuyers: 3531, singleBuyers: 8167, funnelBuyers: 2984, ecosystemBuyers: 575,
  tiers: [
    { label: 'Under $50',   min: 0,    max: 50,      count: 6965, total: 188891 },
    { label: '$50 – $99',   min: 50,   max: 100,     count: 2539, total: 190171 },
    { label: '$100 – $199', min: 100,  max: 200,     count: 792,  total: 130192 },
    { label: '$200 – $499', min: 200,  max: 500,     count: 853,  total: 213474 },
    { label: '$500 – $999', min: 500,  max: 1000,    count: 9,    total: 5520   },
    { label: '$1,000+',     min: 1000, max: Infinity, count: 19,   total: 39803  },
  ],
  topCustomers: [
    { email: 'emhankison@aol.com',        name: 'Emilie Rath',         orders: 3, products: 6, ltv: 2865    },
    { email: 'marghartwick@gmail.com',    name: 'Marg Hartwick',       orders: 4, products: 4, ltv: 2818    },
    { email: 'mariposa729100@aol.com',    name: 'Alejandra Maldonado', orders: 2, products: 3, ltv: 2724    },
    { email: 'charlenefranzen@gmail.com', name: 'Norman Franzen',      orders: 2, products: 2, ltv: 2574    },
    { email: 'leigh@lpkleadership.com',   name: 'Leigh Kearney',       orders: 3, products: 3, ltv: 2555.5  },
    { email: 'nancyhogan442@gmail.com',   name: 'Nancy Hogan',         orders: 3, products: 3, ltv: 2554    },
    { email: 'paulsaks@tfsrep.com',       name: 'Paul Saks',           orders: 1, products: 1, ltv: 2500    },
    { email: 'r-obrien@bigpond.net.au',   name: "Rowena O'Brien",      orders: 1, products: 1, ltv: 2500    },
    { email: 'loritaft@gmail.com',        name: 'Lori Taft',           orders: 5, products: 4, ltv: 1958    },
    { email: 'beachbumdayz@gmail.com',    name: 'Bethany Washburn',    orders: 4, products: 3, ltv: 1836.75 },
  ],
  productPaths: [
    { first: 'RSK (Organic)',        second: '100+ Scripts Bundle',     count: 868 },
    { first: 'RSK (Facebook Ads)',   second: '100+ Scripts',            count: 587 },
    { first: 'RSK (Instagram)',      second: '100+ Scripts',            count: 235 },
    { first: 'RSK (Facebook Nov 3)', second: '100+ Scripts (Facebook)', count: 168 },
    { first: 'RSK Legacy',           second: '100+ Scripts Legacy',     count: 126 },
    { first: 'Cutoff Culture',       second: 'RSK',                     count: 109 },
    { first: 'RSK (Instagram)',      second: '100+ Scripts (Facebook)', count: 104 },
    { first: 'RSK (Facebook)',       second: 'Repair Map',              count: 84  },
    { first: 'RSK (Organic)',        second: 'Cutoff Culture',          count: 74  },
    { first: 'RSK (Organic)',        second: 'Repair Map',              count: 61  },
  ],
  isDemo: true,
  orderCount: 15229,
};

router.get('/data', async (req, res) => {
  const force = req.query.force === '1';
  const KEY   = 'samcart_metrics';

  try {
    if (!force) {
      const cached = await getCached(KEY);
      if (cached) return res.json({ ...cached, fromCache: true });
    }

    const apiKey = await getApiKey();
    if (!apiKey) return res.status(400).json({ error: 'No SamCart API key configured. Go to Settings.' });

    try {
      const orders  = await fetchAllPages('/orders', apiKey);
      const metrics = computeMetrics(orders);
      const payload = { ...metrics, syncedAt: new Date().toISOString(), orderCount: orders.length };
      await setCache(KEY, payload);
      return res.json({ ...payload, fromCache: false });
    } catch (apiErr) {
      console.error('SamCart API error:', apiErr.message);

      // Try stale cache first
      const { data: stale } = await supabase.from('samcart_cache').select('data').eq('cache_key', KEY).single();
      if (stale) {
        try { return res.json({ ...JSON.parse(stale.data), fromCache: true, stale: true }); } catch {}
      }

      // Fall back to demo data
      return res.json({ ...DEMO_DATA, syncedAt: new Date().toISOString(), apiError: apiErr.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sync', async (req, res) => {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) return res.status(400).json({ error: 'No SamCart API key configured.' });
    const orders  = await fetchAllPages('/orders', apiKey);
    const metrics = computeMetrics(orders);
    await setCache('samcart_metrics', { ...metrics, syncedAt: new Date().toISOString(), orderCount: orders.length });
    res.json({ success: true, orderCount: orders.length, syncedAt: new Date().toISOString() });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
