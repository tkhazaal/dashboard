const express  = require('express');
const router   = express.Router();
const fetch    = require('node-fetch');
const https    = require('https');
const supabase = require('../database');
const { utmChannel } = require('../channel');   // shared UTM → channel resolver

const BASE_URL  = 'https://api.samcart.com/v1';
const CACHE_TTL = parseInt(process.env.SAMCART_CACHE_MINUTES || '60', 10) * 60 * 1000;

// Smaller pages = smaller responses = far less chance of a "Premature close"
// on slower connections (env-tunable; SamCart caps per_page at 100).
const PAGE_SIZE = Math.min(100, Math.max(5, parseInt(process.env.SAMCART_PAGE_SIZE || '25', 10)));
// Gentle pause between paginated requests so a long crawl doesn't trip SamCart's
// rate limit (429). Env-tunable; set 0 to disable.
const THROTTLE_MS = Math.max(0, parseInt(process.env.SAMCART_THROTTLE_MS || '200', 10));

// Force a fresh TCP connection per request. Reusing keep-alive sockets is the
// usual cause of "Premature close" during long crawls.
const scAgent = new https.Agent({ keepAlive: false, maxSockets: 4 });

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

// Accept-Encoding: identity disables gzip — a truncated gzip stream is a common
// source of "Premature close", and uncompressed small pages decode reliably.
const SC_HEADERS = apiKey => ({ 'sc-api': apiKey, 'Accept': 'application/json', 'Connection': 'close', 'Accept-Encoding': 'identity' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Fetch one SamCart URL as JSON, retrying transient failures ("Premature close",
// network resets, 5xx). Reads the body fully as text before parsing so a
// truncated response is caught and retried. Client errors (4xx) fail fast.
async function scFetch(url, apiKey, attempts = 6) {
  let lastErr, tries = 0, rateWaits = 0;
  while (tries < attempts) {
    try {
      const resp = await fetch(url, { headers: SC_HEADERS(apiKey), timeout: 45000, agent: scAgent });
      if (!resp.ok) {
        if (resp.status === 429) {
          // Rate limited — wait it out (honor Retry-After, else exponential backoff).
          // A rate-limit pause does NOT consume the transient-retry budget.
          const ra   = parseInt(resp.headers.get('retry-after') || '', 10);
          const wait = (Number.isFinite(ra) && ra > 0) ? ra * 1000 : Math.min(2000 * 2 ** rateWaits, 30000);
          if (++rateWaits > 10) throw new Error('SamCart API 429: rate limit not clearing after repeated waits');
          await sleep(wait);
          continue;
        }
        const txt = await resp.text().catch(() => '');
        if (resp.status >= 400 && resp.status < 500) {
          throw Object.assign(new Error(`SamCart API ${resp.status}: ${txt.slice(0, 200)}`), { fatal: true });
        }
        throw new Error(`SamCart API ${resp.status}`);
      }
      const text = await resp.text();    // read fully (throws on premature close)
      return JSON.parse(text);
    } catch (err) {
      if (err.fatal) throw err;          // don't retry auth/bad-request errors
      lastErr = err;
      tries++;
      if (tries < attempts) await sleep(800 * tries);   // 0.8s, 1.6s, 2.4s, ...
    }
  }
  throw lastErr;
}

// Cursor-paginated fetch — follows pagination.next until exhausted.
async function fetchAllOrders(apiKey, { maxPages = 1000, onProgress } = {}) {
  const all = [];
  let url   = `${BASE_URL}/orders?per_page=${PAGE_SIZE}`;
  let pages = 0;
  let total = null;

  while (url && pages < maxPages) {
    const json = await scFetch(url, apiKey);
    const data = Array.isArray(json) ? json : (json.data || []);
    all.push(...data);
    // First page exposes remaining_count → derive the grand total for the progress bar
    if (total === null && json.pagination && typeof json.pagination.remaining_count === 'number') {
      total = json.pagination.remaining_count + data.length;
    }
    pages++;
    if (onProgress) onProgress(all.length, total);
    url = json.pagination && json.pagination.next ? json.pagination.next : null;
    if (url && THROTTLE_MS) await sleep(THROTTLE_MS);
  }
  return all;
}

// All products — used to map an order's product_id to its checkout slug.
async function fetchProducts(apiKey, { maxPages = 30 } = {}) {
  const all = [];
  let url   = `${BASE_URL}/products?per_page=${PAGE_SIZE}`;
  let pages = 0;
  while (url && pages < maxPages) {
    const json = await scFetch(url, apiKey);
    const data = Array.isArray(json) ? json : (json.data || []);
    all.push(...data);
    pages++;
    url = json.pagination && json.pagination.next ? json.pagination.next : null;
    if (url && THROTTLE_MS) await sleep(THROTTLE_MS);
  }
  return all;
}

// All refunds (cursor-paginated) — for the "amount refunded" metrics.
async function fetchAllRefunds(apiKey, { maxPages = 1000 } = {}) {
  const all = [];
  let url   = `${BASE_URL}/refunds?per_page=${PAGE_SIZE}`;
  let pages = 0;
  while (url && pages < maxPages) {
    const json = await scFetch(url, apiKey);
    const data = Array.isArray(json) ? json : (json.data || []);
    all.push(...data);
    pages++;
    url = json.pagination && json.pagination.next ? json.pagination.next : null;
    if (url && THROTTLE_MS) await sleep(THROTTLE_MS);
  }
  return all;
}

// Fetch a single customer's name/email by id (for top-customer enrichment).
async function fetchCustomer(id, apiKey) {
  try { return await scFetch(`${BASE_URL}/customers/${id}`, apiKey, 2); }
  catch { return null; }
}

// Product identity = internal_product_name (channel-specific, matches SamCart's
// "Sales by Product"); fall back to the customer-facing product_name.
function itemName(it) {
  return (it && (it.internal_product_name || it.product_name)) || 'Unknown Product';
}

// Primary cart item of an order = first non-upsell item (fallback: first item).
function orderMainItem(o) {
  const items = o.cart_items || [];
  return items.find(it => !it.upsell_id) || items[0] || null;
}
function orderProduct(o) {
  return itemName(orderMainItem(o));
}

async function computeMetrics(orders, apiKey) {
  // Map product_id -> checkout slug so orders can be attributed to a funnel slug.
  const slugById = {};
  const productList = [];   // unique product names for the Funnels dropdowns
  const productSlug = {};   // product name -> its checkout slug (for Landing-Page picker)
  try {
    const products = await fetchProducts(apiKey);
    const seen = new Set();
    products.forEach(p => {
      if (p.id != null && p.slug) slugById[p.id] = String(p.slug).toLowerCase();
      const name = p.internal_product_name || p.product_name;   // channel-specific name (like SamCart)
      if (name && !seen.has(name)) { seen.add(name); productList.push(name); }
      if (name && p.slug && !productSlug[name]) productSlug[name] = String(p.slug).toLowerCase();
    });
  } catch { /* attribution is best-effort */ }

  // Per-product purchase counts (any cart line) — drives the Funnels table.
  const productSales = {};   // productName -> { orders, revenue }  (all-time)
  const salesByDay   = {};   // 'YYYY-MM-DD' -> { productName -> { orders, revenue } } (for the Funnels date filter)

  // Refunds — total amount refunded, by month/day (excludes test refunds).
  let totalRefunded = 0, refundCount = 0;
  const refundsByMonth = {};
  const refundsByDay = {};
  try {
    const refunds = await fetchAllRefunds(apiKey);
    for (const r of refunds) {
      if (r.test_mode) continue;
      const amt = (parseFloat(r.refund_amount) || 0) / 100;   // cents -> dollars
      if (!amt) continue;
      totalRefunded += amt; refundCount++;
      const m = String(r.created_at || '').slice(0, 7);        // YYYY-MM
      if (m) refundsByMonth[m] = (refundsByMonth[m] || 0) + amt;
      const dy = String(r.created_at || '').slice(0, 10);      // YYYY-MM-DD
      if (dy) refundsByDay[dy] = (refundsByDay[dy] || 0) + amt;
    }
  } catch { /* refunds are best-effort */ }
  totalRefunded = Math.round(totalRefunded * 100) / 100;

  const dailyRevenue = {};   // 'YYYY-MM-DD' -> { revenue, orders } (distinct orders; for date-filtered Reporting)

  const custMap = new Map();
  const ordersBySlug = {};      // slug -> { orders, revenue }  (all-time)
  const ordersBySlugByDay = {}; // 'YYYY-MM-DD' -> { slug -> { orders, revenue } } (date-filtered Page Analytics)
  const ordersByChannelByDay = {}; // 'YYYY-MM-DD' -> { channel -> { orders, revenue } } from order.utm_parameters
  const ordersByUtmByDay = {};     // 'YYYY-MM-DD' -> { 'source|medium|campaign|content' -> { orders, revenue } }
  const upsellTotals = {};   // upsellName -> { orders, revenue }
  const upsellBySlug = {};   // mainSlug -> { upsellName -> { orders, revenue } }

  for (const o of orders) {
    if (o.test_mode) continue;                         // exclude sandbox/test orders
    const cid = o.customer_id;
    if (cid == null) continue;

    const amount  = (parseFloat(o.total) || 0) / 100;  // SamCart amounts are in cents
    const date    = o.order_date || null;
    const product = orderProduct(o);

    // Daily revenue + distinct order count (drives date-filtered Reporting)
    const dRev = String(date || '').slice(0, 10);
    if (dRev) { (dailyRevenue[dRev] || (dailyRevenue[dRev] = { revenue: 0, orders: 0 })); dailyRevenue[dRev].revenue += amount; dailyRevenue[dRev].orders++; }

    // Attribute the order to a UTM channel + full UTM combo (when the checkout carried UTM)
    const up = o.utm_parameters || {};
    if (dRev && (up.source || up.medium || up.content || up.campaign)) {
      const ch = utmChannel(up.content, up.source, up.medium);
      if (ch && ch !== '(untagged)') {
        if (!ordersByChannelByDay[dRev]) ordersByChannelByDay[dRev] = {};
        if (!ordersByChannelByDay[dRev][ch]) ordersByChannelByDay[dRev][ch] = { orders: 0, revenue: 0 };
        ordersByChannelByDay[dRev][ch].orders++; ordersByChannelByDay[dRev][ch].revenue += amount;
      }
      const norm = v => String(v || '').toLowerCase().trim() || '(none)';
      const ukey = `${norm(up.source)}|${norm(up.medium)}|${norm(up.campaign)}|${norm(up.content)}`;
      if (!ordersByUtmByDay[dRev]) ordersByUtmByDay[dRev] = {};
      if (!ordersByUtmByDay[dRev][ukey]) ordersByUtmByDay[dRev][ukey] = { orders: 0, revenue: 0 };
      ordersByUtmByDay[dRev][ukey].orders++; ordersByUtmByDay[dRev][ukey].revenue += amount;
    }

    // Attribute this order to the main product's slug
    const main = orderMainItem(o);
    const slug = main && slugById[main.product_id];
    if (slug) {
      if (!ordersBySlug[slug]) ordersBySlug[slug] = { orders: 0, revenue: 0 };
      ordersBySlug[slug].orders++;
      ordersBySlug[slug].revenue += amount;
      if (dRev) {
        if (!ordersBySlugByDay[dRev]) ordersBySlugByDay[dRev] = {};
        if (!ordersBySlugByDay[dRev][slug]) ordersBySlugByDay[dRev][slug] = { orders: 0, revenue: 0 };
        ordersBySlugByDay[dRev][slug].orders++;
        ordersBySlugByDay[dRev][slug].revenue += amount;
      }
    }

    // Per-product purchase counts (every cart line = one purchase of that product)
    const oday = String(date || '').slice(0, 10);   // YYYY-MM-DD for date filtering
    for (const it of (o.cart_items || [])) {
      const pname = itemName(it);
      if (!pname || pname === 'Unknown Product') continue;
      const prev = ((it.initial_price && it.initial_price.total) || parseFloat(it.total) || 0) / 100;
      if (!productSales[pname]) productSales[pname] = { orders: 0, revenue: 0 };
      productSales[pname].orders++; productSales[pname].revenue += prev;
      if (oday) {
        if (!salesByDay[oday]) salesByDay[oday] = {};
        if (!salesByDay[oday][pname]) salesByDay[oday][pname] = { orders: 0, revenue: 0 };
        salesByDay[oday][pname].orders++; salesByDay[oday][pname].revenue += prev;
      }
    }

    // Upsell line items (upsell_id set) — attribute to the order's main slug (channel)
    for (const it of (o.cart_items || [])) {
      if (!it.upsell_id) continue;
      const uname = itemName(it) || `Product #${it.product_id}`;
      const urev  = ((it.initial_price && it.initial_price.total) || parseFloat(it.total) || 0) / 100;
      if (!upsellTotals[uname]) upsellTotals[uname] = { orders: 0, revenue: 0 };
      upsellTotals[uname].orders++; upsellTotals[uname].revenue += urev;
      if (slug) {
        if (!upsellBySlug[slug]) upsellBySlug[slug] = {};
        if (!upsellBySlug[slug][uname]) upsellBySlug[slug][uname] = { orders: 0, revenue: 0 };
        upsellBySlug[slug][uname].orders++; upsellBySlug[slug][uname].revenue += urev;
      }
    }

    if (!custMap.has(cid)) custMap.set(cid, { cid, orders: [], products: new Set(), ltv: 0 });
    const c = custMap.get(cid);
    c.orders.push({ amount, product, date });
    (o.cart_items || []).forEach(it => { if (it.product_name) c.products.add(it.product_name); });
    c.ltv += amount;
  }

  const customers = [...custMap.values()].map(c => ({
    cid: c.cid,
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
    .filter(p => p.first !== p.second)
    .sort((a, b) => b.count - a.count).slice(0, 10);

  // Top customers — enrich the top 20 with real names/emails from /customers/{id}.
  // Sequential (with throttle) rather than 20 concurrent requests, to avoid a burst
  // that trips the rate limit.
  const topRaw = [...customers].sort((a, b) => b.ltv - a.ltv).slice(0, 20);
  const topCustomers = [];
  for (const c of topRaw) {
    const info = await fetchCustomer(c.cid, apiKey);
    const name = info ? `${info.first_name||''} ${info.last_name||''}`.trim() : '';
    topCustomers.push({
      name:  name || `Customer #${c.cid}`,
      email: info?.email || '',
      orders: c.orders, products: c.products, ltv: c.ltv,
    });
    if (THROTTLE_MS) await sleep(THROTTLE_MS);
  }

  // ── Monthly revenue trend (last 12 months) ──────────────────────
  const monthMap = new Map();
  for (const c of customers) {
    for (const o of c.orderList) {
      if (!o.date) continue;
      const m = String(o.date).slice(0, 7); // YYYY-MM
      if (!monthMap.has(m)) monthMap.set(m, { revenue: 0, orders: 0 });
      const e = monthMap.get(m);
      e.revenue += o.amount; e.orders++;
    }
  }
  const monthly = [...monthMap.entries()]
    .sort((a, b) => a[0] < b[0] ? -1 : 1)
    .slice(-12)
    .map(([month, v]) => {
      const refunds = Math.round((refundsByMonth[month] || 0) * 100) / 100;
      return { month, revenue: Math.round(v.revenue * 100) / 100, orders: v.orders, refunds, net: Math.round((v.revenue - refunds) * 100) / 100 };
    });

  // Month-over-month — compare the two most-recent COMPLETED months.
  // The current calendar month is partial, so including it understates growth.
  const curMonthKey = new Date().toISOString().slice(0, 7);
  const completedMonths = monthly.filter(m => m.month !== curMonthKey);
  const monthToDate = monthly.find(m => m.month === curMonthKey) || null;
  let momRevenue = null, momOrders = null, momLabel = null;
  if (completedMonths.length >= 2) {
    const cur = completedMonths[completedMonths.length - 1], prev = completedMonths[completedMonths.length - 2];
    momRevenue = prev.revenue ? Math.round(((cur.revenue - prev.revenue) / prev.revenue) * 1000) / 10 : null;
    momOrders  = prev.orders  ? Math.round(((cur.orders  - prev.orders ) / prev.orders ) * 1000) / 10 : null;
    momLabel   = cur.month; // the completed month the comparison reflects
  }

  // ── Top products by revenue ─────────────────────────────────────
  const prodMap = new Map();
  for (const c of customers) {
    for (const o of c.orderList) {
      if (!prodMap.has(o.product)) prodMap.set(o.product, { revenue: 0, units: 0 });
      const e = prodMap.get(o.product);
      e.revenue += o.amount; e.units++;
    }
  }
  const topProducts = [...prodMap.entries()]
    .map(([name, v]) => ({ name, revenue: Math.round(v.revenue * 100) / 100, units: v.units }))
    .sort((a, b) => b.revenue - a.revenue).slice(0, 10);

  const totalOrders = customers.reduce((s, c) => s + c.orders, 0);

  // Round slug-attributed revenue
  for (const k of Object.keys(ordersBySlug)) {
    ordersBySlug[k].revenue = Math.round(ordersBySlug[k].revenue * 100) / 100;
  }
  // Round upsell revenue + build sorted dropdown list
  for (const u of Object.keys(upsellTotals)) upsellTotals[u].revenue = Math.round(upsellTotals[u].revenue * 100) / 100;
  for (const s of Object.keys(upsellBySlug)) for (const u of Object.keys(upsellBySlug[s])) upsellBySlug[s][u].revenue = Math.round(upsellBySlug[s][u].revenue * 100) / 100;
  const upsellProducts = Object.entries(upsellTotals)
    .map(([name, v]) => ({ name, orders: v.orders, revenue: v.revenue }))
    .sort((a, b) => b.orders - a.orders);

  // Round product-sales revenue; sort the dropdown list (real sales first, drafts last)
  for (const n of Object.keys(productSales)) productSales[n].revenue = Math.round(productSales[n].revenue * 100) / 100;
  const isDraft = n => /draft|turned off|^test|^sc test/i.test(n);
  const sortedProductList = productList.sort((a, b) => {
    const sa = (productSales[a]?.orders || 0), sb = (productSales[b]?.orders || 0);
    return (isDraft(a) - isDraft(b)) || (sb - sa) || a.localeCompare(b);
  });

  return {
    totalCustomers: total,
    totalRevenue:   Math.round(revenue * 100) / 100,
    totalOrders,
    avgOrderValue:  totalOrders ? Math.round((revenue / totalOrders) * 100) / 100 : 0,
    avgLtv:         Math.round(avgLtv * 100) / 100,
    medianLtv:      Math.round(medianLtv * 100) / 100,
    repeatBuyers:   repeats.length,
    singleBuyers:   total - repeats.length,
    repeatRate:     total ? Math.round((repeats.length / total) * 1000) / 10 : 0,
    avgOrdersPerCustomer: total ? Math.round((totalOrders / total) * 100) / 100 : 0,
    funnelBuyers:   funnelCount,
    ecosystemBuyers: ecosystemCount,
    momRevenue, momOrders, momLabel, monthToDate,
    totalRefunded,
    refundCount,
    refundRate:     revenue ? Math.round((totalRefunded / revenue) * 1000) / 10 : 0,
    netRevenue:     Math.round((revenue - totalRefunded) * 100) / 100,
    tiers: TIERS, topCustomers, productPaths, monthly, topProducts,
    ordersBySlug, ordersBySlugByDay, ordersByChannelByDay, ordersByUtmByDay, upsellProducts, upsellBySlug,
    productSales, productList: sortedProductList, productSlug, salesByDay,
    dailyRevenue, refundsByDay,
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
    // Serve cache if present (unless forced)
    if (!force) {
      const cached = await getCached(KEY);
      if (cached) return res.json({ ...cached, fromCache: true });
    }

    const apiKey = await getApiKey();
    if (!apiKey) return res.json({ ...DEMO_DATA, syncedAt: new Date().toISOString(), note: 'No API key configured' });

    // A full crawl is slow (~130 pages); only do it when forced (Sync button).
    // Otherwise serve stale cache or demo so the dashboard stays responsive.
    if (!force) {
      const { data: stale } = await supabase.from('samcart_cache').select('data').eq('cache_key', KEY).single();
      if (stale) { try { return res.json({ ...JSON.parse(stale.data), fromCache: true }); } catch {} }
      return res.json({ ...DEMO_DATA, syncedAt: new Date().toISOString(), note: 'Click “Sync SamCart” to pull live data' });
    }

    try {
      const orders  = await fetchAllOrders(apiKey);
      const metrics = await computeMetrics(orders, apiKey);
      const payload = { ...metrics, syncedAt: new Date().toISOString(), orderCount: orders.length };
      await setCache(KEY, payload);
      return res.json({ ...payload, fromCache: false });
    } catch (apiErr) {
      console.error('SamCart API error:', apiErr.message);
      const { data: stale } = await supabase.from('samcart_cache').select('data').eq('cache_key', KEY).single();
      if (stale) { try { return res.json({ ...JSON.parse(stale.data), fromCache: true, stale: true }); } catch {} }
      return res.json({ ...DEMO_DATA, syncedAt: new Date().toISOString(), apiError: apiErr.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Background sync — a full crawl takes minutes, so run it detached and let
// the dashboard poll /sync/status. Avoids reverse-proxy request timeouts.
// phase: 'orders' (crawling) → 'processing' (products/refunds/customers) → done.
let syncState = { running: false, phase: null, startedAt: null, finishedAt: null, orderCount: 0, total: null, auto: false, error: null };

async function runSync(apiKey, { auto = false } = {}) {
  syncState = { running: true, phase: 'orders', startedAt: new Date().toISOString(), finishedAt: null, orderCount: 0, total: null, auto, error: null };
  try {
    const orders = await fetchAllOrders(apiKey, {
      onProgress: (n, total) => { syncState.orderCount = n; if (total) syncState.total = total; },
    });
    syncState.phase = 'processing';
    syncState.total = orders.length;
    const metrics = await computeMetrics(orders, apiKey);
    await setCache('samcart_metrics', { ...metrics, syncedAt: new Date().toISOString(), orderCount: orders.length });
    syncState.finishedAt = new Date().toISOString();
  } catch (err) {
    syncState.error = err.message;
    console.error('SamCart sync failed:', err.message);
  } finally {
    syncState.running = false;
    syncState.phase = null;
  }
}

router.post('/sync', async (req, res) => {
  const apiKey = await getApiKey();
  if (!apiKey) return res.status(400).json({ error: 'No SamCart API key configured.' });
  if (syncState.running) return res.json({ started: false, running: true, orderCount: syncState.orderCount, total: syncState.total });
  runSync(apiKey); // fire-and-forget
  res.json({ started: true, running: true });
});

router.get('/sync/status', (req, res) => res.json(syncState));

// ── Scheduled auto-sync ───────────────────────────────────────────
// Keeps the cache fresh automatically (default every 60 min; env-tunable).
// Only syncs when the cache is older than the interval, so container restarts
// don't trigger redundant crawls.
const SYNC_MINUTES  = Math.max(0, parseInt(process.env.SAMCART_SYNC_MINUTES || '60', 10));
const SYNC_INTERVAL = SYNC_MINUTES * 60 * 1000;

async function autoSync() {
  try {
    if (syncState.running) return;
    const apiKey = await getApiKey();
    if (!apiKey) return;
    const { data } = await supabase.from('samcart_cache').select('cached_at').eq('cache_key', 'samcart_metrics').single();
    const age = data ? Date.now() - new Date(data.cached_at).getTime() : Infinity;
    if (age < SYNC_INTERVAL) return;            // cache still fresh
    console.log('  Auto-syncing SamCart (cache stale)…');
    runSync(apiKey, { auto: true });            // fire-and-forget
  } catch (err) { console.error('autoSync error:', err.message); }
}

function startAutoSync() {
  if (SYNC_INTERVAL <= 0) { console.log('  SamCart auto-sync disabled (SAMCART_SYNC_MINUTES=0)'); return; }
  console.log(`  SamCart auto-sync every ${SYNC_MINUTES} min`);
  setTimeout(autoSync, 20000);                  // initial check ~20s after boot
  setInterval(autoSync, Math.min(SYNC_INTERVAL, 15 * 60 * 1000)); // re-check periodically
}

router.startAutoSync = startAutoSync;
module.exports = router;
