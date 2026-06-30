'use strict';

// ── Helpers ──────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
// "Now" anchored to Eastern Time, so every "today" / "this month" / preset range
// is computed on EST regardless of the viewer's browser timezone — matching the
// EST-based backend data. The returned Date's local fields reflect ET wall-clock.
const nowET = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
// Format a timestamp in Eastern Time for display (e.g. "Jun 26, 2026, 2:30 PM").
const fmtET = ts => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const fmtNum      = n => n == null ? '—' : Number(n).toLocaleString();
const fmtMoney    = n => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtMoneyFull= n => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n, total) => total ? Math.round((n / total) * 100) + '%' : '0%';
const timeAgo = iso => {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};
const escHtml = str => String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ── Campaign labels (URL path → friendly source name) ─────────────
const CAMPAIGN_LABELS = {
  // Father's Day funnel (offer.taniakhazaal.com)
  '/fathers-repair-playbook':     'FB Posts',
  '/the-fathers-repair-playbook': 'FB Stories',
  '/fathers-repair-guide':        'IG Posts',
  '/the-fathers-repair-guide':    'IG Stories',
  '/fathers-repair-system':       'Emails',
  '/the-fathers-repair-system':   'TikTok',
  '/fathers-repair-bundle':       'FB Group',
  '/fathers-repair-play-book':    'FB Ads',
  '/thank-you':                   'Thank You (Conversion)',
  // Cutoff Culture funnel (go.taniakhazaal.com) — landing pages (View / Unique)
  '/thecutoffculture':                 'IG Posts',
  '/cutoffculture-thenewrules':        'IG Stories',
  '/thecutoff-culture':                'FB Posts',
  '/cutoff-culture-thenew-rules':      'FB Stories',
  '/the-cutoff-culture-the-new-rules': 'FB Group',
  '/cutoff-culture':                   'Email',
  '/the-cutoff-culture':               'Legacy',
  '/cutoffculture':                    'TikTok',
  // Reconnect Starter Kit funnel (go.taniakhazaal.com) — landing pages (View / Unique)
  '/the-reconnect-starterkit':         'IG Posts',
  '/thereconnect-starter-kit-27':      'IG Stories',
  '/the-reconnect-starter-kit':        'FB Posts',
  '/the-reconnectstarter-kit-27':      'FB Stories',
  '/the-reconnectstarterkit':          'FB Group',
  '/thereconnectstarter-kit':          'Email',
  '/reconnect-starter-kit':            'Legacy',
  '/thereconnectstarterkit':           'TikTok',
};
const campaignName = path => {
  const key = String(path || '').replace(/\/+$/, '').toLowerCase() || '/';
  return CAMPAIGN_LABELS[key] || null;
};

// A page is a SamCart checkout if its host contains "samcart" OR its path
// starts with /product (SamCart checkout slugs come through as /product/<slug>).
const isCheckoutHost = host => /samcart/i.test(host || '');
const isCheckoutPage = (path, host) =>
  isCheckoutHost(host) || /^\/products?(\/|$)/i.test(String(path || ''));

// GoHighLevel order-confirmation pages (/complete/<id>) are post-purchase, not landing
// traffic — exclude from view/unique counts (raw rows are kept for later use).
const isConfirmationPage = path => /^\/complete(\/|$)/i.test(String(path || ''));

// Funnel slug = the last path segment, lowercased. This is the shared key
// between a landing page (/fathers-repair-guide) and its SamCart checkout
// (/product/fathers-repair-guide).
function slugKey(path) {
  const segs = String(path || '').toLowerCase().replace(/\/+$/, '').split('/').filter(Boolean);
  return segs.length ? segs[segs.length - 1] : '/';
}
const titleCase = s => String(s || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// SamCart orders attributed to a slug. Matches the funnel/checkout slug to a
// product slug exactly, or after stripping a trailing variant number
// (e.g. checkout "the-repair-map147" -> product "the-repair-map").
function ordersForSlug(slug) {
  const map = state.scData && state.scData.ordersBySlug;
  if (!map || !slug) return null;
  if (map[slug]) return map[slug];
  const stripped = slug.replace(/\d+$/, '').replace(/-+$/, '');
  if (stripped && map[stripped]) return map[stripped];
  return null;
}
// The Page-Analytics date window as [start,end], matching paRangeParams. null = all-time.
function paEffectiveRange() {
  if (state.paStart && state.paEnd) return [state.paStart, state.paEnd];
  if (state.paDays > 0) { const now = nowET(); const s = new Date(now); s.setDate(s.getDate() - (state.paDays - 1)); return [ymd(s), ymd(now)]; }
  return null;   // all time
}
// Page Analytics orders — date-filtered to the active window, else all-time.
function ordersForSlugPA(slug) {
  const range = paEffectiveRange();
  if (!range) return ordersForSlug(slug);
  const all = state.scData && state.scData.ordersBySlug;
  const byDay = state.scData && state.scData.ordersBySlugByDay;
  if (!all || !byDay) return ordersForSlug(slug);   // day-level not synced yet → fall back
  // Pick the same key ordersForSlug would (exact, else digit-stripped)
  let key = all[slug] ? slug : null;
  if (!key) { const st = slug.replace(/\d+$/, '').replace(/-+$/, ''); if (st && all[st]) key = st; }
  if (!key) return null;
  let o = 0, r = 0;
  for (const day of daysInRange(range[0], range[1])) {
    const e = byDay[day] && byDay[day][key];
    if (e) { o += e.orders; r += e.revenue; }
  }
  return { orders: o, revenue: r };
}

// Upsell sales for a given main slug + upsell product name (same slug matching)
function upsellForSlug(slug, upsellName) {
  const map = state.scData && state.scData.upsellBySlug;
  if (!map || !slug || !upsellName) return null;
  const entry = map[slug] || map[slug.replace(/\d+$/, '').replace(/-+$/, '')];
  return (entry && entry[upsellName]) || null;
}

// ── Campaign / product groups (keyword-based, editable) ───────────
// A page belongs to the FIRST group whose keyword its slug contains.
const PAGE_GROUPS = [
  { name: "Father's Day",          keywords: ['fathers-repair', 'fathers'] },
  { name: 'Cutoff Culture',        keywords: ['cutoff'] },
  { name: 'The Repair Map',        keywords: ['repair-map', 'repairmap'] },
  { name: 'Reconnect Starter Kit', keywords: ['reconnect'] },
  { name: '100+ Scripts Bundle',   keywords: ['scripts', '100-scripts'] },
  { name: "She's in Power",        keywords: ['shes-in-power', 'in-power'] },
  { name: 'Renewal Collective',    keywords: ['renewal'] },
  { name: 'New Year Reset',        keywords: ['new-year', 'reset'] },
  { name: "Q&A Vault",             keywords: ['qa-vault', 'q-a-vault', 'vault'] },
];
function groupOf(slug, path) {
  const s = (String(slug || '') + ' ' + String(path || '')).toLowerCase();
  for (const g of PAGE_GROUPS) if (g.keywords.some(k => s.includes(k))) return g.name;
  return 'Other';
}

// SamCart checkout slug -> channel-specific product name (inverted from productSlug).
// Lets us label a checkout page by its channel (IG Posts, FB Ads, …) instead of the slug.
let _slug2prod = null, _slug2prodSrc = null;
function slugToProductName(slug) {
  const ps = state.scData && state.scData.productSlug;   // name -> slug
  if (!ps || !slug) return null;
  if (_slug2prodSrc !== ps) { _slug2prod = {}; for (const n in ps) if (!_slug2prod[ps[n]]) _slug2prod[ps[n]] = n; _slug2prodSrc = ps; }
  return _slug2prod[slug] || null;
}
// "Cutoff Culture: IG Posts" / "RSK IG Posts" / "RSK Legacy" -> "IG Posts" / "Legacy"
function productChannel(name) {
  if (!name) return null;
  let s = name; const i = s.lastIndexOf(':'); if (i >= 0) s = s.slice(i + 1);
  return s.replace(/^\s*(RSK|CC)\s+/i, '').trim() || null;
}
// "Checkout — <channel>" for a SamCart checkout slug, or null if the product is unknown
function checkoutLabel(slug) {
  const chan = productChannel(slugToProductName(slug));
  return chan ? `Checkout — ${chan}` : null;
}

// Host-aware label: checkout pages get a "Checkout — <channel>" label from the SamCart
// product behind the slug (falls back to the slug); otherwise the campaign map.
function pageLabel(path, host) {
  if (isCheckoutHost(host)) {
    const byChannel = checkoutLabel(slugKey(path));
    if (byChannel) return byChannel;
    const seg = String(path || '').split('/').filter(Boolean).pop() || '';
    const name = seg.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return name ? `Checkout — ${name}` : 'Checkout';
  }
  return campaignName(path);
}

async function api(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ── Theme (light / dark) ──────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const label = $('themeLabel');
  if (label) label.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
  try { localStorage.setItem('_mtd_theme', theme); } catch {}
}
function initTheme() {
  let saved;
  try { saved = localStorage.getItem('_mtd_theme'); } catch {}
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
  const btn = $('themeBtn');
  if (btn) btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });
}
initTheme();

// ── State ─────────────────────────────────────────────────────────
const state = {
  ovDays:      30,
  cmpPreset:   'mtd',
  compare:     null,
  ovFunnel:    null,
  paDays:      30,
  paStart:     '',
  paEnd:       '',
  paSearch:    '',
  paSort:      'total_views',
  paGroup:     true,
  paUpsell:    '',
  expandedGroups: new Set(),
  funnelsConfig: null,
  funnelStart:   '',
  funnelEnd:     '',
  funnelPages:   null,
  adCampaigns:   null,
  adStart:       '',
  adEnd:         '',
  trendDays:   30,
  cuSearch:    '',
  cuBuyerType: 'all',
  cuTier:      'all',
  cuSort:      'ltv',
  pathSearch:  '',
  pathRole:    'any',
  pathMin:     0,
  monthlyGoal: 0,

  // Cached raw SamCart data (for client-side filtering)
  scData:      null,
  // Cached raw pages data
  pagesData:   [],
  // Conversion funnel (current month)
  funnelData:  null,
  // Reporting page support data
  reportsTrend:     null,
  reportsReferrers: null,
  repSource:        'samcart',
  repStart:         '',
  repEnd:           '',
  repKajabi:        null,
  acData:           null,
  kajabiData:       null,
  utmData:          null,
};

// ── Tab navigation ────────────────────────────────────────────────
function activateTab(tab) {
  const item = document.querySelector(`.nav-item[data-tab="${tab}"]`);
  const section = $(`tab-${tab}`);
  if (!item || !section) return;
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  item.classList.add('active');
  section.classList.add('active');
  if (history.replaceState) history.replaceState(null, '', '#' + tab);
  // Charts must be built while their canvas is visible (Chart.js needs real dimensions)
  if (tab === 'reports') loadReports();
  if (tab === 'funnels') loadFunnels();
  if (tab === 'ads') loadAds();
  if (tab === 'kajabi') loadKajabi();
  if (tab === 'email') loadEmail();
  if (tab === 'social') loadSocial();
  if (tab === 'alerts') loadAlerts();
  if (tab === 'utm') loadUtm();
  if (tab === 'forms') loadForms();
}
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => { e.preventDefault(); activateTab(item.dataset.tab); });
});
// Deep-link: open the tab named in the URL hash on load
window.addEventListener('DOMContentLoaded', () => {
  const tab = (location.hash || '').replace('#', '');
  if (tab && document.querySelector(`.nav-item[data-tab="${tab}"]`)) activateTab(tab);
});

// ── Per-tab Refresh ───────────────────────────────────────────────
// Each reporting tab gets its own Refresh button that reloads only that tab's data
// (and re-renders the widgets it shows). Sidebar "Refresh All Data" still does everything.
const REFRESHABLE = new Set(['overview', 'reports', 'funnels', 'ads', 'kajabi', 'email', 'social', 'alerts', 'pages', 'utm', 'customers', 'behaviour', 'paths']);
async function refreshTab(tab, btn) {
  if (btn) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Refreshing…'; }
  try {
    if (tab === 'overview')      await Promise.allSettled([applyCompare(state.cmpPreset || 'mtd'), loadSamCart(), loadKajabiData(), loadMetaSpend()]);
    else if (tab === 'reports')  { await loadSamCart(); await loadReports(); }
    else if (tab === 'funnels')  { await Promise.allSettled([loadSamCart(), loadPagesTable()]); renderFunnels(); }
    else if (tab === 'ads')      { await loadSamCart(); renderAds(); }
    else if (tab === 'kajabi')   await loadKajabi();
    else if (tab === 'email')    await loadEmail();
    else if (tab === 'social')   await loadSocial();
    else if (tab === 'alerts')   { await loadSamCart(); renderAlerts(); updateAlertBadge(); }
    else if (tab === 'pages')    await Promise.allSettled([loadPagesTable(), loadSamCart()]);
    else if (tab === 'utm')      await loadUtm();
    else if (tab === 'customers' || tab === 'behaviour' || tab === 'paths') await loadSamCart();
  } catch {}
  finally { if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.label || '↻ Refresh'; } }
}
// Inject a Refresh button into each refreshable tab's header
document.querySelectorAll('.tab').forEach(sec => {
  const tab = sec.id.replace('tab-', '');
  if (!REFRESHABLE.has(tab)) return;
  const header = sec.querySelector('.page-header'); if (!header) return;
  let pills = header.querySelector('.header-pills');
  if (!pills) { pills = document.createElement('div'); pills.className = 'header-pills'; header.appendChild(pills); }
  if (pills.querySelector('.refresh-tab')) return;
  const btn = document.createElement('button');
  btn.className = 'refresh-tab'; btn.type = 'button'; btn.dataset.refresh = tab; btn.innerHTML = '↻ Refresh';
  pills.appendChild(btn);
});
document.addEventListener('click', e => { const b = e.target.closest('.refresh-tab'); if (b) refreshTab(b.dataset.refresh, b); });

// ── Version + What's New ──────────────────────────────────────────
function openWhatsNew() {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const sec = $('tab-whatsnew'); if (sec) sec.classList.add('active');
  if (history.replaceState) history.replaceState(null, '', '#whatsnew');
  renderWhatsNew();
}
function renderWhatsNew() {
  const log = (typeof CHANGELOG !== 'undefined' && CHANGELOG) || [];
  $('whatsnew-version').textContent = 'Current: v' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '1.0.0');
  $('whatsnewList').innerHTML = log.map((r, i) => `
    <div class="card release${i === 0 ? ' release-latest' : ''}">
      <div class="release-head">
        <span class="release-ver">v${escHtml(r.version)}</span>
        ${i === 0 ? '<span class="release-badge">Latest</span>' : ''}
        <span class="release-title">${escHtml(r.title)}</span>
        <span class="release-date">${escHtml(r.date)}</span>
      </div>
      <ul class="release-changes">
        ${(r.changes || []).map(c => `<li><strong>${escHtml(c.title)}</strong> — ${escHtml(c.detail)}</li>`).join('')}
      </ul>
    </div>`).join('');
}
if ($('versionBtn')) {
  $('versionBtn').textContent = 'v' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '1.0.0');
  $('versionBtn').addEventListener('click', openWhatsNew);
}
if ((location.hash || '') === '#whatsnew') openWhatsNew();

// ── Date button groups ────────────────────────────────────────────
function initDateBtns(groupId, onSelect) {
  const group = $(groupId);
  if (!group) return;
  group.querySelectorAll('.date-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      group.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onSelect(parseInt(btn.dataset.days, 10));
    });
  });
}

// ── Charts ────────────────────────────────────────────────────────
let trendChart, buyerSplitChart, revenueChart;

// Month-over-month delta badge (green up / red down)
function monthName(key) {
  if (!key) return '';
  const [y, m] = key.split('-');
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' });
}
function momHtml(val, suffix) {
  if (val == null || isNaN(val)) return '';
  const up = val >= 0;
  return `<span class="delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(val)}%</span> ${suffix || 'vs prior month'}`;
}

function buildTrendChart(rows) {
  const ctx = $('trendChart');
  if (!ctx) return;
  if (trendChart) trendChart.destroy();

  const labels = rows.map(r => {
    const d = new Date(r.day);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Page Views',      data: rows.map(r=>r.views),           borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.08)', fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 5 },
        { label: 'Unique Visitors', data: rows.map(r=>r.unique_visitors),  borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.06)', fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 5 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#94a3b8', maxTicksLimit: 12 } },
        y: { grid: { color: 'rgba(148,163,184,0.18)' }, ticks: { font: { size: 11 }, color: '#94a3b8' }, beginAtZero: true }
      }
    }
  });
}

function buildBuyerSplitChart(single, repeat) {
  const ctx = $('buyerSplitChart');
  if (!ctx) return;
  if (buyerSplitChart) buyerSplitChart.destroy();

  buyerSplitChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Single Buyers', 'Repeat Buyers'],
      datasets: [{ data: [single, repeat], backgroundColor: ['#e8eaf0', '#2563eb'], borderWidth: 0, hoverOffset: 6 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '70%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmtNum(ctx.raw)}` } }
      }
    }
  });

  const legend = $('buyerSplitLegend');
  if (legend) {
    legend.innerHTML = `
      <div class="legend-item"><div class="legend-dot" style="background:#2563eb"></div>Repeat (${fmtNum(repeat)})</div>
      <div class="legend-item"><div class="legend-dot" style="background:#e8eaf0;border:1px solid #d1d5db"></div>Single (${fmtNum(single)})</div>
    `;
  }
}

function buildRevenueChart(monthly) {
  const ctx = $('revenueChart');
  if (!ctx) return;
  if (revenueChart) revenueChart.destroy();
  const rows = monthly || [];

  const labels = rows.map(r => {
    const [y, m] = r.month.split('-');
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  });

  revenueChart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        { type: 'bar',  label: 'Revenue', data: rows.map(r=>r.revenue), backgroundColor: 'rgba(37,99,235,0.85)', borderRadius: 4, yAxisID: 'y',  order: 2 },
        { type: 'line', label: 'Orders',  data: rows.map(r=>r.orders),  borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', tension: 0.4, pointRadius: 3, yAxisID: 'y1', order: 1 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { font: { size: 11 }, color: '#6b7280', boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => ctx.dataset.label === 'Revenue' ? ` Revenue: ${fmtMoney(ctx.raw)}` : ` Orders: ${fmtNum(ctx.raw)}` } }
      },
      scales: {
        x:  { grid: { display: false }, ticks: { font: { size: 11 }, color: '#94a3b8' } },
        y:  { position: 'left',  grid: { color: 'rgba(148,163,184,0.18)' }, ticks: { font: { size: 11 }, color: '#94a3b8', callback: v => '$' + (v >= 1000 ? (v/1000)+'k' : v) }, beginAtZero: true },
        y1: { position: 'right', grid: { display: false },   ticks: { font: { size: 11 }, color: '#10b981' }, beginAtZero: true }
      }
    }
  });
}

function renderSalesAnalytics(d) {
  if (!d) return;
  renderGoal();
  renderFunnel();
  $('sa-revenue').textContent   = fmtMoney(d.totalRevenue);
  $('sa-orders').textContent    = fmtNum(d.totalOrders);
  $('sa-aov').textContent       = fmtMoneyFull(d.avgOrderValue);
  $('sa-repeatRate').textContent= (d.repeatRate != null ? d.repeatRate + '%' : '—');
  const momSuffix = d.momLabel ? `(${monthName(d.momLabel)} vs prior)` : 'vs prior month';
  $('sa-revenueMom').innerHTML  = momHtml(d.momRevenue, momSuffix);
  $('sa-ordersMom').innerHTML   = momHtml(d.momOrders, momSuffix);
  $('sa-ordersPerCust').textContent = d.avgOrdersPerCustomer ? `${d.avgOrdersPerCustomer} orders / customer` : '';

  const months = d.monthly || [];
  $('sa-trendRange').textContent = months.length ? `${months.length} months` : '';
  buildRevenueChart(months);

  const prods = d.topProducts || [];
  $('topProductsTable').innerHTML = prods.length === 0
    ? `<tr class="empty-row"><td colspan="4">No product data yet — click Sync SamCart.</td></tr>`
    : prods.map((p, i) => `
        <tr>
          <td class="rank">${i + 1}</td>
          <td class="name-cell">${escHtml(p.name)}</td>
          <td>${fmtNum(p.units)}</td>
          <td class="ltv-cell">${fmtMoney(p.revenue)}</td>
        </tr>
      `).join('');
}

// ── Analytics loaders ─────────────────────────────────────────────
// ── Overview: compare-periods engine ──────────────────────────────
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtRange = (a, b) => { const o = { month: 'short', day: 'numeric' }; return `${a.toLocaleDateString('en-US', o)} – ${b.toLocaleDateString('en-US', o)}`; };
function comparePeriods(preset) {
  const now = nowET(); const d = x => { const t = new Date(now); t.setDate(t.getDate() + x); return t; };
  let curStart, curEnd = now, prevStart, prevEnd;
  if (preset === '7d')       { curStart = d(-6);  prevEnd = d(-7);  prevStart = d(-13); }
  else if (preset === '30d') { curStart = d(-29); prevEnd = d(-30); prevStart = d(-59); }
  else if (preset === 'ytd') { curStart = new Date(now.getFullYear(), 0, 1); prevStart = new Date(now.getFullYear() - 1, 0, 1); prevEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); }
  else                       { curStart = new Date(now.getFullYear(), now.getMonth(), 1); prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1); prevEnd = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()); }
  return { curStart, curEnd, prevStart, prevEnd };
}
function setDeltaPill(id, cur, prev) {
  const el = $(id); if (!el) return;
  const dv = prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;
  if (dv == null) { el.className = 'delta-pill flat'; el.textContent = '— vs prev'; return; }
  el.className = 'delta-pill ' + (dv >= 0 ? 'up' : 'down');
  el.textContent = `${dv >= 0 ? '▲' : '▼'} ${Math.abs(dv)}% vs prev`;
}
async function applyCompare(preset) {
  state.cmpPreset = preset;
  const p = comparePeriods(preset);
  state.compare = { curStart: ymd(p.curStart), curEnd: ymd(p.curEnd), prevStart: ymd(p.prevStart), prevEnd: ymd(p.prevEnd), label: fmtRange(p.curStart, p.curEnd) };
  $('cmp-cur').textContent  = fmtRange(p.curStart, p.curEnd);
  $('cmp-prev').textContent = fmtRange(p.prevStart, p.prevEnd);
  $('ovf-range').textContent = state.compare.label;
  try {
    const [cur, prev] = await Promise.all([
      api(`/api/analytics/overview?start=${state.compare.curStart}&end=${state.compare.curEnd}`),
      api(`/api/analytics/overview?start=${state.compare.prevStart}&end=${state.compare.prevEnd}`),
    ]);
    $('ov-totalViews').textContent = fmtNum(cur.totalViews);
    $('ov-uniqueVisitors').textContent = fmtNum(cur.uniqueVisitors);
    setDeltaPill('ov-d-views', cur.totalViews, prev.totalViews);
    setDeltaPill('ov-d-visitors', cur.uniqueVisitors, prev.uniqueVisitors);
  } catch {}
  // Total Revenue for the selected period (SamCart + Kajabi), delta vs previous period
  renderOverviewRevenue();
  // Funnel for the current period (kept separate from the Sales-Analytics funnel)
  try { state.ovFunnel = await api(`/api/analytics/funnel?start=${state.compare.curStart}&end=${state.compare.curEnd}`); } catch {}
  renderOverviewFunnel();
}

// Sum a {day:{revenue,orders}} (or {day:number}) map over an inclusive date range
function sumDaily(obj, start, end, field = 'revenue') {
  if (!obj || !start || !end) return 0;
  let t = 0;
  for (const day of daysInRange(start, end)) { const e = obj[day]; if (e != null) t += (typeof e === 'number' ? e : (e[field] || 0)); }
  return t;
}
// Total Revenue card = SamCart + Kajabi revenue for the selected compare period
function renderOverviewRevenue() {
  const c = state.compare; if (!c) return;
  const sc = state.scData && state.scData.dailyRevenue, kj = state.kajabiData && state.kajabiData.dailyRevenue;
  let curSc = sumDaily(sc, c.curStart, c.curEnd);
  // Fallback while day-level data isn't cached yet: use SamCart month-to-date for 'mtd'
  if (!curSc && state.cmpPreset === 'mtd' && state.scData?.monthToDate?.revenue) curSc = state.scData.monthToDate.revenue;
  const curRev  = curSc + sumDaily(kj, c.curStart, c.curEnd);
  const prevRev = sumDaily(sc, c.prevStart, c.prevEnd) + sumDaily(kj, c.prevStart, c.prevEnd);
  const el = $('ov-totalRevenue'); if (el) el.textContent = fmtMoney(curRev);
  setDeltaPill('ov-d-revenue', curRev, prevRev);
}

// ── Overview widgets ──────────────────────────────────────────────
function renderOverviewFunnel() {
  const el = $('ovf-bars'); if (!el) return;
  const f = state.ovFunnel || state.funnelData || {};
  const purchases = state.scData?.monthToDate?.orders || 0;
  const upsell = (state.scData?.upsellProducts || []).reduce((s, u) => s + u.orders, 0);
  const stages = [
    { label: 'Landing',  value: f.landingUnique || 0 },
    { label: 'Checkout', value: f.checkoutUnique || 0 },
    { label: 'Purchase', value: purchases },
    { label: 'Upsell',   value: upsell },
  ];
  const base = Math.max(stages[0].value, ...stages.map(s => s.value), 1);
  el.innerHTML = stages.map((s, i) => {
    const h = Math.max(5, Math.round((s.value / base) * 100));
    const conv = i === 0 ? 100 : (stages[i - 1].value ? Math.round((s.value / stages[i - 1].value) * 1000) / 10 : 0);
    const drop = i === 0 ? null : Math.round((100 - conv) * 10) / 10;
    const tip = i === 0 ? 'Top of funnel' : `Conv ${conv}% · Drop ${drop}%`;
    return `
      <div class="stepbar">
        <div class="stepbar-track">
          <div class="stepbar-fill g${i + 1}" style="height:${h}%"><span class="stepbar-tip">${tip}</span></div>
        </div>
        <div class="stepbar-value">${fmtNum(s.value)}</div>
        <div class="stepbar-label">${s.label}</div>
      </div>`;
  }).join('');
}

let _grossMode = 'products';
function renderGrossVolume() {
  const d = state.scData; if (!d || !$('ovg-total')) return;
  $('ovg-total').textContent = fmtMoney(d.totalRevenue);
  $('ovg-sub').textContent = `Net ${fmtMoney(d.netRevenue)} · Refunds ${fmtMoney(d.totalRefunded || 0)}`;
  const colors = ['#10b981', '#3b82f6', '#ec4899', '#f59e0b', '#6366f1'];
  let rows;
  if (_grossMode === 'tiers') rows = (d.tiers || []).filter(t => t.total > 0).map(t => ({ name: t.label, val: t.total }));
  else rows = (d.topProducts || []).slice(0, 5).map(p => ({ name: p.name, val: p.revenue }));
  const max = Math.max(...rows.map(r => r.val), 1);
  $('ovg-bars').innerHTML = rows.map((r, i) => {
    const w = Math.max(2, Math.round((r.val / max) * 100));
    const share = d.totalRevenue ? Math.round((r.val / d.totalRevenue) * 1000) / 10 : 0;
    return `
      <div class="gross-row" title="${escHtml(r.name)}: ${fmtMoney(r.val)} · ${share}% of revenue">
        <div class="gross-row-head">
          <span class="gross-dot" style="background:${colors[i % colors.length]}"></span>
          <span class="gross-name">${escHtml(r.name)}</span>
          <span class="gross-amt">${fmtMoney(r.val)}</span>
        </div>
        <div class="gross-track"><div class="gross-fill" style="width:${w}%;background:${colors[i % colors.length]}"></div></div>
      </div>`;
  }).join('') || '<p class="muted" style="font-size:12px">No product data yet — Sync SamCart.</p>';
}

function renderInsightCard() {
  const d = state.scData; if (!d || !$('ovi-big')) return;
  let big, text, glyph = '', cls = '';
  if (d.momRevenue != null) {
    const up = d.momRevenue >= 0; glyph = up ? '▲' : '▼'; cls = up ? 'up' : 'down';
    big = Math.abs(d.momRevenue) + '%';
    text = `Revenue is ${up ? 'up' : 'down'} ${Math.abs(d.momRevenue)}% month-over-month, now ${fmtMoney(d.monthToDate?.revenue || 0)} this month.`;
  } else if (d.repeatRate) {
    big = d.repeatRate + '%';
    text = `${d.repeatRate}% of customers are repeat buyers — your checkout sequence and ecosystem are compounding.`;
  } else {
    big = (100 - (d.refundRate || 0)) + '%';
    text = `${100 - (d.refundRate || 0)}% of revenue sticks — refund rate is just ${d.refundRate || 0}%.`;
  }
  $('ovi-big').innerHTML = glyph ? `<span class="ovi-glyph ${cls}">${glyph}</span>${big}` : big;
  $('ovi-text').textContent = text;
}

async function loadTrend(days) {
  const rows = await api(`/api/analytics/trend?days=${days}`);
  buildTrendChart(rows);
}

// Build query params for Page Analytics — custom range takes priority over preset days.
function paRangeParams() {
  const p = new URLSearchParams();
  if (state.paStart && state.paEnd) { p.set('start', state.paStart); p.set('end', state.paEnd); }
  else if (state.paDays > 0)        { p.set('days', state.paDays); }
  return p;
}

async function loadPaStats() {
  const overview = await api(`/api/analytics/overview?${paRangeParams()}`);
  $('pa-totalViews').textContent     = fmtNum(overview.totalViews);
  $('pa-uniqueVisitors').textContent = fmtNum(overview.uniqueVisitors);
  $('pa-weekViews').textContent      = fmtNum(overview.weekViews);
  $('pa-monthViews').textContent     = fmtNum(overview.monthViews);
}

// ── Conversion funnel (current month, aligned with SamCart month-to-date) ──
async function loadFunnel() {
  const now = nowET();
  const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
  const start = `${y}-${m}-01`;
  const end   = `${y}-${m}-${String(now.getDate()).padStart(2, '0')}`;
  $('funnel-range').textContent = now.toLocaleDateString('en-US', { month: 'long' });
  try { state.funnelData = await api(`/api/analytics/funnel?start=${start}&end=${end}`); }
  catch { state.funnelData = null; }
  renderFunnel();
}

function renderFunnel() {
  const f = state.funnelData;
  if (!f) return;
  const landing   = f.landingViews  || 0;
  const checkout  = f.checkoutViews || 0;
  const purchases = state.scData?.monthToDate?.orders ?? null;

  $('fn-landing').textContent      = fmtNum(landing);
  $('fn-landing-sub').textContent  = `${fmtNum(f.landingUnique || 0)} unique`;
  $('fn-checkout').textContent     = fmtNum(checkout);
  $('fn-checkout-sub').textContent = `${fmtNum(f.checkoutUnique || 0)} unique`;
  $('fn-purchases').textContent    = purchases != null ? fmtNum(purchases) : '—';
  $('fn-purchases-sub').textContent= purchases != null ? 'from SamCart' : 'Sync SamCart';

  $('fn-rate1').textContent = landing ? Math.round((checkout / landing) * 1000) / 10 + '%' : '—';
  $('fn-rate2').textContent = (checkout && purchases != null) ? Math.round((purchases / checkout) * 1000) / 10 + '%' : '—';

  if (checkout === 0) {
    $('funnel-note').innerHTML = '⚠️ No checkout views yet — add the tracking snippet to your SamCart checkout pages to complete the funnel.';
  } else {
    $('funnel-note').textContent = 'Aligned to the current month. Page-tracking only covers the days since the snippet was installed, so early ratios may look off until a full month accrues.';
  }
}

async function loadPagesTable() {
  const params = paRangeParams();
  const rows = await api(`/api/analytics/pages?${params}`);
  state.pagesData = rows;
  renderPagesTable(rows);
  loadPaStats();
}

const rowLabel = e => e.landingPath
  ? (campaignName(e.landingPath) || e.title || e.landingPath)
  : (checkoutLabel(e.slug) || `Checkout — ${titleCase(e.slug)}`);

// Build per-slug aggregated rows from the raw page-view rows.
function buildSlugRows(rows) {
  const map = new Map();
  for (const r of rows) {
    if (isConfirmationPage(r.page_path)) continue;   // skip GHL /complete/<id> confirmations
    const checkout = isCheckoutPage(r.page_path, r.host);
    const slug = slugKey(r.page_path);
    if (!map.has(slug)) map.set(slug, {
      slug, landingViews: 0, landingUnique: 0, checkoutViews: 0, checkoutUnique: 0,
      landingPath: null, title: null, host: null, lastSeen: null,
    });
    const e = map.get(slug);
    if (checkout) {
      e.checkoutViews  += r.total_views;
      e.checkoutUnique += r.unique_visitors;
      if (!e.host) e.host = r.host;
      if (!e.checkoutTitle && r.page_title) e.checkoutTitle = r.page_title;  // product name from checkout page
    } else {
      e.landingViews  += r.total_views;
      e.landingUnique += r.unique_visitors;
      if (!e.landingPath) { e.landingPath = r.page_path; e.title = r.page_title; }
    }
    if (!e.lastSeen || new Date(r.last_seen) > new Date(e.lastSeen)) e.lastSeen = r.last_seen;
  }
  return [...map.values()];
}

function sortSlugRows(list) {
  return list.sort((a, b) => {
    if (state.paSort === 'unique_visitors') return b.landingUnique  - a.landingUnique;
    if (state.paSort === 'checkout_views')  return b.checkoutViews  - a.checkoutViews;
    if (state.paSort === 'orders')          return (ordersForSlugPA(b.slug)?.orders || 0)  - (ordersForSlugPA(a.slug)?.orders || 0);
    if (state.paSort === 'order_value')     return (ordersForSlugPA(b.slug)?.revenue || 0) - (ordersForSlugPA(a.slug)?.revenue || 0);
    if (state.paSort === 'upsell')          return (upsellForSlug(b.slug, state.paUpsell)?.orders || 0) - (upsellForSlug(a.slug, state.paUpsell)?.orders || 0);
    return b.landingViews - a.landingViews;
  });
}

// One data row (member or flat) — returns <tr> HTML
function slugRowHtml(e, rank, indent) {
  const ord = ordersForSlugPA(e.slug);
  const ups = state.paUpsell ? upsellForSlug(e.slug, state.paUpsell) : null;
  const displayPath = e.landingPath || `/${e.slug}`;
  return `
    <tr class="${indent ? 'member-row' : ''}">
      <td class="rank">${rank}</td>
      <td>
        <div class="name-cell">${escHtml(rowLabel(e))}</div>
        <div class="email-cell">${escHtml(displayPath)}</div>
      </td>
      <td>${fmtNum(e.landingViews)}</td>
      <td>${fmtNum(e.landingUnique)}</td>
      <td>${e.checkoutViews ? `<span class="checkout-count" title="${fmtNum(e.checkoutUnique)} unique">${fmtNum(e.checkoutViews)}</span>` : '<span class="muted">—</span>'}</td>
      <td>${ord ? `<span class="orders-count">${fmtNum(ord.orders)}</span>` : '<span class="muted">—</span>'}</td>
      <td>${ord ? `<span class="value-count">${fmtMoney(ord.revenue)}</span>` : '<span class="muted">—</span>'}</td>
      <td class="upsell-col">${ups ? `<span class="upsell-count" title="${fmtMoney(ups.revenue)}">${fmtNum(ups.orders)}</span>` : '<span class="muted">—</span>'}</td>
      <td class="email-cell">${timeAgo(e.lastSeen)}</td>
    </tr>`;
}

function renderPagesTable(rows) {
  let list = buildSlugRows(rows);

  // Search
  if (state.paSearch) {
    const q = state.paSearch.toLowerCase();
    list = list.filter(e => rowLabel(e).toLowerCase().includes(q) || e.slug.includes(q) || String(e.title || '').toLowerCase().includes(q));
  }

  // Toggle the upsell column on the table
  const tableEl = $('pagesTableEl');
  if (tableEl) tableEl.classList.toggle('show-upsell', !!state.paUpsell);

  const body = $('pagesTable');
  if (!list.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="9">No page views yet — add the tracking code to your pages.</td></tr>`;
    $('pa-resultCount').textContent = '0 pages';
    return;
  }

  if (!state.paGroup) {
    // Flat view
    sortSlugRows(list);
    $('pa-resultCount').textContent = `${fmtNum(list.length)} page${list.length !== 1 ? 's' : ''}`;
    body.innerHTML = list.map((e, i) => slugRowHtml(e, i + 1, false)).join('');
    return;
  }

  // Grouped view — aggregate slug rows into campaign/product groups
  const groups = {};
  for (const e of list) {
    const gname = groupOf(e.slug, e.landingPath);
    if (!groups[gname]) groups[gname] = { name: gname, rows: [], landingViews: 0, landingUnique: 0, checkoutViews: 0, orders: 0, value: 0, upsellOrders: 0, upsellRevenue: 0, lastSeen: null };
    const g = groups[gname];
    g.rows.push(e);
    g.landingViews += e.landingViews; g.landingUnique += e.landingUnique; g.checkoutViews += e.checkoutViews;
    const ord = ordersForSlugPA(e.slug); if (ord) { g.orders += ord.orders; g.value += ord.revenue; }
    const ups = state.paUpsell ? upsellForSlug(e.slug, state.paUpsell) : null; if (ups) { g.upsellOrders += ups.orders; g.upsellRevenue += ups.revenue; }
    if (!g.lastSeen || new Date(e.lastSeen) > new Date(g.lastSeen)) g.lastSeen = e.lastSeen;
  }
  const groupList = Object.values(groups).sort((a, b) =>
    (a.name === 'Other') - (b.name === 'Other') || b.landingViews - a.landingViews);

  $('pa-resultCount').textContent = `${groupList.length} group${groupList.length !== 1 ? 's' : ''} · ${fmtNum(list.length)} pages`;

  body.innerHTML = groupList.map(g => {
    const open = state.expandedGroups.has(g.name);
    const header = `
      <tr class="group-row ${open ? 'open' : ''}" data-group="${escHtml(g.name)}">
        <td class="group-toggle">${open ? '▾' : '▸'}</td>
        <td><span class="group-name">${escHtml(g.name)}</span> <span class="group-count">${g.rows.length}</span></td>
        <td>${fmtNum(g.landingViews)}</td>
        <td>${fmtNum(g.landingUnique)}</td>
        <td>${g.checkoutViews ? `<span class="checkout-count">${fmtNum(g.checkoutViews)}</span>` : '<span class="muted">—</span>'}</td>
        <td>${g.orders ? `<span class="orders-count">${fmtNum(g.orders)}</span>` : '<span class="muted">—</span>'}</td>
        <td>${g.value ? `<span class="value-count">${fmtMoney(g.value)}</span>` : '<span class="muted">—</span>'}</td>
        <td class="upsell-col">${g.upsellOrders ? `<span class="upsell-count" title="${fmtMoney(g.upsellRevenue)}">${fmtNum(g.upsellOrders)}</span>` : '<span class="muted">—</span>'}</td>
        <td></td>
      </tr>`;
    const members = open ? sortSlugRows(g.rows).map((e, i) => slugRowHtml(e, i + 1, true)).join('') : '';
    return header + members;
  }).join('');
}

// Expand / collapse groups (event delegation)
$('pagesTable').addEventListener('click', e => {
  const row = e.target.closest('.group-row');
  if (!row) return;
  const name = row.dataset.group;
  if (state.expandedGroups.has(name)) state.expandedGroups.delete(name);
  else state.expandedGroups.add(name);
  if (state.pagesData) renderPagesTable(state.pagesData);
});

// Populate the upsell dropdown from SamCart data
function populateUpsellDropdown() {
  const list = $('pa-upsell-list'), input = $('pa-upsell');
  if (!list || !input) return;
  const items = (state.scData && state.scData.upsellProducts) || [];
  list.innerHTML = items.map(u => `<option value="${escHtml(u.name)}">${fmtNum(u.orders)} orders</option>`).join('');
  input.value = state.paUpsell || '';
}

function renderReferrersTable(rows) {
  $('referrersTable').innerHTML = rows.length === 0
    ? `<tr class="empty-row"><td colspan="3">No data yet.</td></tr>`
    : rows.map(r => `
        <tr>
          <td class="name-cell">${escHtml(r.source.slice(0, 60))}</td>
          <td>${fmtNum(r.visits)}</td>
          <td>${fmtNum(r.unique_visitors)}</td>
        </tr>
      `).join('');
}

async function loadLiveFeed(pageFilter) {
  const params = new URLSearchParams();
  if (pageFilter) params.set('page', pageFilter);
  const rows = await api(`/api/analytics/recent?${params}`);
  $('liveFeed').innerHTML = rows.length === 0
    ? `<tr class="empty-row"><td colspan="4">No visits recorded yet.</td></tr>`
    : rows.map(r => {
        const label = campaignName(r.page_path);
        return `
        <tr>
          <td>
            <div class="name-cell">${escHtml(label || r.page_path)}</div>
            ${label ? `<div class="email-cell">${escHtml(r.page_path)}</div>` : ''}
          </td>
          <td class="email-cell">${escHtml((r.referrer||'Direct').slice(0,50))}</td>
          <td class="email-cell">${escHtml(r.ip_address||'')}</td>
          <td class="email-cell">${timeAgo(r.created_at)}</td>
        </tr>
      `;}).join('');
}

// ── SamCart loaders ───────────────────────────────────────────────
async function loadSamCart(force = false) {
  const url = force ? '/api/samcart/data?force=1' : '/api/samcart/data';
  let data;
  try { data = await api(url); }
  catch (err) {
    $('scSyncedAt').textContent = 'SamCart: ' + (err.message||'').slice(0, 60);
    return;
  }

  state.scData = data;
  updateAlertBadge();   // refresh the sidebar "Alerts" count whenever SamCart data loads

  // Overview KPI cards
  $('ov-totalCustomers').textContent = fmtNum(data.totalCustomers);   // all-time (lifetime)
  const cs = $('ov-customersSub'); if (cs) cs.textContent = `Avg LTV ${fmtMoneyFull(data.avgLtv)} · all-time`;
  renderOverviewRevenue();   // Total Revenue is period-based (SamCart + Kajabi)

  // Overview widgets
  renderGrossVolume();
  renderInsightCard();
  renderOverviewFunnel();

  buildBuyerSplitChart(data.singleBuyers, data.repeatBuyers);
  renderSalesAnalytics(data);
  renderCustomers();
  renderTiers(data.tiers);
  renderBehaviour(data);
  renderPaths();
  populateUpsellDropdown();
  // Re-render the pages table so the Orders/Upsell columns (from SamCart) populate
  if (state.pagesData && state.pagesData.length) renderPagesTable(state.pagesData);
  // If the Reporting tab is open, refresh its charts with the new data
  if ($('tab-reports')?.classList.contains('active')) renderReports();
  if ($('tab-funnels')?.classList.contains('active')) renderFunnels();
}

// ── Customer rendering (client-side filtered) ────────────────────
function renderCustomers() {
  const d = state.scData;
  if (!d) return;

  const q     = state.cuSearch.toLowerCase();
  const tier  = state.cuTier;
  const btype = state.cuBuyerType;

  let list = (d.topCustomers || []).filter(c => {
    if (q && !c.name.toLowerCase().includes(q) && !c.email.toLowerCase().includes(q)) return false;
    if (btype === 'single' && c.orders > 1) return false;
    if (btype === 'repeat' && c.orders <= 1) return false;
    if (tier !== 'all') {
      if (tier === '1000+') { if (c.ltv < 1000) return false; }
      else {
        const [min, max] = tier.split('-').map(Number);
        if (c.ltv < min || c.ltv >= max) return false;
      }
    }
    return true;
  });

  // Sort
  list = list.sort((a, b) => {
    if (state.cuSort === 'orders')   return b.orders - a.orders;
    if (state.cuSort === 'products') return b.products - a.products;
    if (state.cuSort === 'name')     return a.name.localeCompare(b.name);
    return b.ltv - a.ltv;
  });

  $('cu-shown').textContent    = `${fmtNum(list.length)} / ${fmtNum(d.totalCustomers)}`;
  $('cu-avgLtv').textContent   = fmtMoneyFull(d.avgLtv);
  $('cu-medianLtv').textContent= fmtMoneyFull(d.medianLtv);
  $('cu-repeat').textContent   = fmtNum(d.repeatBuyers);
  $('cu-resultCount').textContent = `${fmtNum(list.length)} customer${list.length !== 1 ? 's' : ''}`;

  $('customersTable').innerHTML = list.length === 0
    ? `<tr class="empty-row"><td colspan="5">No customers match your filters.</td></tr>`
    : list.map((c, i) => `
        <tr>
          <td class="rank">${i + 1}</td>
          <td>
            <div class="name-cell">${escHtml(c.name)}</div>
            <div class="email-cell">${escHtml(c.email)}</div>
          </td>
          <td>${fmtNum(c.orders)}</td>
          <td>${fmtNum(c.products)}</td>
          <td class="ltv-cell">${fmtMoneyFull(c.ltv)}</td>
        </tr>
      `).join('');
}

function renderTiers(tiers) {
  const maxCount = Math.max(...(tiers||[]).map(t=>t.count), 1);
  $('tiersContainer').innerHTML = (tiers||[]).map(t => `
    <div class="tier-row">
      <div class="tier-label">${escHtml(t.label)}</div>
      <div class="tier-bar-wrap"><div class="tier-bar" style="width:${Math.round((t.count/maxCount)*100)}%"></div></div>
      <div class="tier-count">${fmtNum(t.count)}</div>
      <div class="tier-total">${fmtMoney(Math.round(t.total))} total</div>
    </div>
  `).join('');
}

function renderBehaviour(data) {
  const total = (data.singleBuyers||0) + (data.repeatBuyers||0);
  $('pb-single').textContent    = fmtNum(data.singleBuyers);
  $('pb-singlePct').textContent = pct(data.singleBuyers, total) + ' of all customers';
  $('pb-repeat').textContent    = fmtNum(data.repeatBuyers);
  $('pb-repeatPct').textContent = pct(data.repeatBuyers, total) + ' of all customers';
  $('pb-funnel').textContent    = fmtNum(data.funnelBuyers);
  $('pb-ecosystem').textContent = fmtNum(data.ecosystemBuyers);

  const funnelPct = pct(data.funnelBuyers, data.repeatBuyers);
  $('insight-funnel').textContent = `${funnelPct} of repeat buyers converted in the same session. The upsell architecture is your primary revenue multiplier.`;
  $('insight-single').textContent = `${fmtNum(data.singleBuyers)} customers (${pct(data.singleBuyers, total)}) have never returned. A targeted re-engagement campaign represents the largest untapped revenue opportunity.`;
  $('rd-funnel').textContent    = fmtNum(data.funnelBuyers);
  $('rd-ecosystem').textContent = fmtNum(data.ecosystemBuyers);
}

// ── Product paths rendering (client-side filtered) ───────────────
function renderPaths() {
  const d = state.scData;
  if (!d) return;

  const q    = state.pathSearch.toLowerCase();
  const role = state.pathRole;
  const min  = state.pathMin || 0;

  let list = (d.productPaths || []).filter(p => {
    if (min > 0 && p.count < min) return false;
    if (!q) return true;
    if (role === 'first')  return p.first.toLowerCase().includes(q);
    if (role === 'second') return p.second.toLowerCase().includes(q);
    return p.first.toLowerCase().includes(q) || p.second.toLowerCase().includes(q);
  });

  const maxCount = Math.max(...list.map(p => p.count), 1);
  $('path-resultCount').textContent = `${fmtNum(list.length)} path${list.length !== 1 ? 's' : ''}`;

  $('pathsTable').innerHTML = list.length === 0
    ? `<tr class="empty-row"><td colspan="6">No paths match your filters.</td></tr>`
    : list.map((p, i) => `
        <tr>
          <td class="rank">${i + 1}</td>
          <td class="name-cell">${escHtml(p.first)}</td>
          <td class="arrow">→</td>
          <td class="name-cell">${escHtml(p.second)}</td>
          <td>${fmtNum(p.count)}</td>
          <td class="bar-cell"><div class="bar-mini" style="width:${Math.round((p.count/maxCount)*100)}%"></div></td>
        </tr>
      `).join('');
}

// ── Settings ──────────────────────────────────────────────────────
async function loadSettings() {
  const s = await api('/api/settings');
  const form = $('settingsForm');
  if (s.site_name)   form.site_name.value   = s.site_name;
  if (s.tracker_url) form.tracker_url.value = s.tracker_url;
  if (s.monthly_goal) { form.monthly_goal.value = s.monthly_goal; $('goal-input').value = s.monthly_goal; }
  if (s.samcart_api_key_masked) $('apiKeyMasked').textContent = 'Current key: ' + s.samcart_api_key_masked;
  if (s.ac_api_url) form.ac_api_url.value = s.ac_api_url;
  $('kajabiHint').textContent = s.kajabi_client_id_masked
    ? `Connected ✓ · ID ${s.kajabi_client_id_masked}${s.kajabi_client_secret_masked ? ' · secret ' + s.kajabi_client_secret_masked : ''}`
    : 'Not connected';
  $('acHint').textContent = s.ac_api_token_masked
    ? `Connected ✓ · key ${s.ac_api_token_masked}` : 'Not connected';
  if ($('apifyHint')) $('apifyHint').textContent = s.apify_token_masked ? `Connected ✓ · token ${s.apify_token_masked}` : 'Not connected';
  if (form.instagram_username && s.instagram_username) form.instagram_username.value = s.instagram_username;
  if (form.facebook_page_url && s.facebook_page_url) form.facebook_page_url.value = s.facebook_page_url;
  if (form.meta_ad_account_id && s.meta_ad_account_id) form.meta_ad_account_id.value = s.meta_ad_account_id;
  if ($('metaAcctHint'))   $('metaAcctHint').textContent   = s.meta_ad_account_id ? `Account ${s.meta_ad_account_id}` : 'Not set';
  if ($('metaTokenHint'))  $('metaTokenHint').textContent  = s.meta_ads_token_masked ? `Connected ✓ · token ${s.meta_ads_token_masked}` : 'Not connected';
  if ($('metaSecretHint')) $('metaSecretHint').textContent = s.meta_app_secret_masked ? `Set ✓ · ${s.meta_app_secret_masked}` : 'Optional — not set';
  state.monthlyGoal = parseFloat(s.monthly_goal) || 0;
  if (s.funnels_config) { try { state.funnelsConfig = JSON.parse(s.funnels_config); } catch {} }
  if (s.ad_campaigns)   { try { state.adCampaigns   = JSON.parse(s.ad_campaigns);   } catch {} }
  updateTrackingCode(s.tracker_url || 'http://localhost:3000');
  renderGoal();
}

// ── Monthly goal progress ─────────────────────────────────────────
// Kajabi revenue for the current month (counts toward the monthly goal)
function kajabiMtdRevenue() {
  const d = state.kajabiData;
  if (!d || !Array.isArray(d.monthly)) return 0;
  const mo = ymd(nowET()).slice(0, 7);
  const row = d.monthly.find(m => m.month === mo);
  return row ? row.revenue : 0;
}

function renderGoal() {
  const goal = state.monthlyGoal || 0;
  const scMtd = state.scData?.monthToDate?.revenue || 0;
  const kjMtd = kajabiMtdRevenue();
  const current = scMtd + kjMtd;   // total business revenue this month (SamCart + Kajabi)

  // Current month label
  const now = nowET();
  $('goal-month').textContent = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  $('goal-current').textContent = fmtMoney(current);
  $('goal-target').textContent  = goal ? fmtMoney(goal) : 'no goal set';

  if (!goal) {
    $('goal-pct').textContent = '';
    $('goal-bar').style.width = '0%';
    $('goal-meta').textContent = 'Set a monthly goal to track progress.';
    return;
  }

  const pctVal = Math.min(100, Math.round((current / goal) * 1000) / 10);
  const reached = current >= goal;
  $('goal-pct').textContent = pctVal + '%';
  $('goal-pct').className = 'goal-pct ' + (reached ? 'done' : '');
  $('goal-bar').style.width = pctVal + '%';
  $('goal-bar').className = 'goal-bar' + (reached ? ' done' : '');

  // Days left in month + pace needed
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(0, daysInMonth - now.getDate());
  const remaining = Math.max(0, goal - current);

  const breakdown = kjMtd > 0 ? ` <span class="muted">· SamCart ${fmtMoney(scMtd)} + Kajabi ${fmtMoney(kjMtd)}</span>` : '';
  if (reached) {
    $('goal-meta').innerHTML = `<span class="delta up">🎉 Goal reached!</span> ${fmtMoney(current - goal)} over target with ${daysLeft} days to spare.${breakdown}`;
  } else {
    const perDay = daysLeft > 0 ? remaining / daysLeft : remaining;
    $('goal-meta').innerHTML = `<strong>${fmtMoney(remaining)}</strong> to go · ${daysLeft} day${daysLeft!==1?'s':''} left · need <strong>${fmtMoney(Math.round(perDay))}/day</strong> to hit target${breakdown}`;
  }
}

async function saveGoal(value) {
  const goal = parseFloat(value) || 0;
  state.monthlyGoal = goal;
  $('settingsForm').monthly_goal.value = goal || '';
  renderGoal();
  await fetch('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ monthly_goal: String(goal) })
  });
}

$('goal-save').addEventListener('click', () => saveGoal($('goal-input').value));
$('goal-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveGoal($('goal-input').value); });

function updateTrackingCode(baseUrl) {
  $('trackingCode').textContent = `<!-- Metric Tracking Dashboard -->\n<script async src="${baseUrl}/t.js"><\/script>`;
}

$('settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  const r = await fetch('/api/settings', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if (r.ok) {
    $('settingsSaved').textContent = '✓ Settings saved.';
    updateTrackingCode(body.tracker_url || 'http://localhost:3000');
    if (body.monthly_goal !== undefined) {
      state.monthlyGoal = parseFloat(body.monthly_goal) || 0;
      $('goal-input').value = state.monthlyGoal || '';
      renderGoal();
    }
    if (body.samcart_api_key) loadSamCart(true);
    // Re-sync integrations whose credentials just changed
    if (body.kajabi_client_id || body.kajabi_client_secret) { $('settingsSaved').textContent = '✓ Saved — syncing Kajabi…'; fetch('/api/kajabi/sync', { method: 'POST' }); }
    if (body.ac_api_url || body.ac_api_token)               { $('settingsSaved').textContent = '✓ Saved — syncing Email…';  fetch('/api/ac/sync', { method: 'POST' }); }
    if (body.apify_token || body.instagram_username) fetch('/api/instagram/sync', { method: 'POST' });
    if (body.apify_token || body.facebook_page_url)  fetch('/api/facebook/sync', { method: 'POST' });
    e.target.reset(); loadSettings();    // clear secret fields + refresh hints
    setTimeout(() => { $('settingsSaved').textContent = ''; }, 4000);
  } else {
    $('settingsSaved').textContent = '⚠ Save failed';
  }
});

$('copyCodeBtn').addEventListener('click', () => {
  navigator.clipboard.writeText($('trackingCode').textContent).then(() => {
    $('copyCodeBtn').textContent = 'Copied!';
    setTimeout(() => { $('copyCodeBtn').textContent = 'Copy'; }, 2000);
  });
});

// ── Sync button ───────────────────────────────────────────────────
// ── Sync status: unified progress bar (manual + auto syncs) ───────
let _syncWasRunning = false;
let _syncFastTimer = null;

function renderSyncProgress(s) {
  const el = $('syncStatus');
  if (!el) return;
  if (s && s.running) {
    $('syncBtn').disabled = true;
    let pct = 0, label;
    if (s.phase === 'processing') {
      pct = 100; label = 'Processing…';
    } else if (s.total) {
      pct = Math.min(99, Math.round((s.orderCount / s.total) * 100));
      label = `${fmtNum(s.orderCount)} / ${fmtNum(s.total)} orders`;
    } else {
      pct = 4; label = `${fmtNum(s.orderCount)} orders…`;
    }
    el.innerHTML = `
      <div class="sync-row"><span>${s.auto ? 'Auto-syncing' : 'Syncing'}</span><span>${pct}%</span></div>
      <div class="sync-bar-wrap"><div class="sync-bar ${s.phase === 'processing' ? 'indet' : ''}" style="width:${pct}%"></div></div>
      <div class="sync-sub">${label}</div>`;
  } else {
    $('syncBtn').disabled = false;
    if (s && s.error) el.innerHTML = `<span class="sync-err">⚠ ${escHtml(s.error.slice(0, 48))}</span>`;
    else if (state.scData?.syncedAt && !state.scData.isDemo) el.textContent = 'Synced ' + timeAgo(state.scData.syncedAt);
    else el.textContent = '';
  }
}

async function pollSyncStatus() {
  let s;
  try { s = await api('/api/samcart/sync/status'); } catch { return; }
  renderSyncProgress(s);
  if (s.running) {
    _syncWasRunning = true;
    if (!_syncFastTimer) _syncFastTimer = setInterval(pollSyncStatus, 3000);  // poll fast while running
  } else {
    if (_syncFastTimer) { clearInterval(_syncFastTimer); _syncFastTimer = null; }
    if (_syncWasRunning) {            // a sync just finished → refresh dashboard data
      _syncWasRunning = false;
      await loadSamCart(true);
    }
  }
}

$('syncBtn').addEventListener('click', async () => {
  $('syncBtn').disabled = true;
  $('syncStatus').textContent = 'Starting…';
  try {
    const r = await fetch('/api/samcart/sync', { method: 'POST' });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    pollSyncStatus();                 // kick the poller; it drives the bar + refresh
  } catch (err) {
    $('syncStatus').textContent = 'Error: ' + err.message.slice(0, 60);
    $('syncBtn').disabled = false;
  }
});

// Detect auto-syncs (and in-progress syncs on load); slow heartbeat every 25s
setInterval(pollSyncStatus, 25000);
setTimeout(pollSyncStatus, 2000);

// ── Wire up Overview filters ──────────────────────────────────────
$('cmp-preset').addEventListener('change', e => applyCompare(e.target.value));
$('ovg-toggle').addEventListener('click', e => {
  const btn = e.target.closest('button[data-g]'); if (!btn) return;
  _grossMode = btn.dataset.g;
  $('ovg-toggle').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
  renderGrossVolume();
});

initDateBtns('trend-dateBtns', days => {
  state.trendDays = days;
  loadTrend(days);
});

let feedDebounce;
$('feedSearch').addEventListener('input', e => {
  clearTimeout(feedDebounce);
  feedDebounce = setTimeout(() => loadLiveFeed(e.target.value.trim()), 300);
});

// ── Wire up Page Analytics filters ───────────────────────────────
initDateBtns('pa-dateBtns', days => {
  state.paDays = days;
  // Selecting a preset clears any custom range
  state.paStart = ''; state.paEnd = '';
  $('pa-start').value = ''; $('pa-end').value = '';
  $('pa-range-clear').hidden = true;
  loadPagesTable();
});

// Custom date-range picker
function applyDateRange() {
  const s = $('pa-start').value, e = $('pa-end').value;
  if (!s || !e) return;
  // Normalize if reversed
  state.paStart = s <= e ? s : e;
  state.paEnd   = s <= e ? e : s;
  $('pa-start').value = state.paStart; $('pa-end').value = state.paEnd;
  // Deactivate preset buttons — a custom range is now in effect
  document.querySelectorAll('#pa-dateBtns .date-btn').forEach(b => b.classList.remove('active'));
  $('pa-range-clear').hidden = false;
  loadPagesTable();
}
$('pa-start').addEventListener('change', applyDateRange);
$('pa-end').addEventListener('change', applyDateRange);

$('pa-range-clear').addEventListener('click', () => {
  state.paStart = ''; state.paEnd = '';
  $('pa-start').value = ''; $('pa-end').value = '';
  $('pa-range-clear').hidden = true;
  // Restore the default 30-day preset
  state.paDays = 30;
  document.querySelectorAll('#pa-dateBtns .date-btn').forEach(b => b.classList.toggle('active', b.dataset.days === '30'));
  loadPagesTable();
});

$('pa-search').addEventListener('input', e => {
  state.paSearch = e.target.value.trim();
  if (state.pagesData) renderPagesTable(state.pagesData);
});

$('pa-group').addEventListener('change', e => {
  state.paGroup = e.target.checked;
  if (state.pagesData) renderPagesTable(state.pagesData);
});

$('pa-upsell').addEventListener('change', e => {
  state.paUpsell = e.target.value;
  if (state.pagesData) renderPagesTable(state.pagesData);
});

// Column sort clicks
document.querySelectorAll('.sortable[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    document.querySelectorAll('.sortable[data-sort]').forEach(h => {
      h.classList.remove('active-sort');
      h.textContent = h.textContent.replace(/ [↑↓]$/, '');
    });
    th.classList.add('active-sort');
    state.paSort = th.dataset.sort;
    th.textContent += ' ↓';
    renderPagesTable(state.pagesData);
  });
});

// ── Wire up Customer filters ──────────────────────────────────────
let cuDebounce;
$('cu-search').addEventListener('input', e => {
  clearTimeout(cuDebounce);
  cuDebounce = setTimeout(() => { state.cuSearch = e.target.value.trim(); renderCustomers(); }, 200);
});

$('cu-buyerType').addEventListener('change', e => { state.cuBuyerType = e.target.value; renderCustomers(); });
$('cu-tier').addEventListener('change',      e => { state.cuTier      = e.target.value; renderCustomers(); });
$('cu-sort').addEventListener('change',      e => { state.cuSort      = e.target.value; renderCustomers(); });

$('cu-clear').addEventListener('click', () => {
  $('cu-search').value  = '';
  $('cu-buyerType').value = 'all';
  $('cu-tier').value    = 'all';
  $('cu-sort').value    = 'ltv';
  state.cuSearch = ''; state.cuBuyerType = 'all'; state.cuTier = 'all'; state.cuSort = 'ltv';
  renderCustomers();
});

// Customer column sort clicks
document.querySelectorAll('.sortable[data-cu-sort]').forEach(th => {
  th.addEventListener('click', () => {
    document.querySelectorAll('.sortable[data-cu-sort]').forEach(h => h.classList.remove('active-sort'));
    th.classList.add('active-sort');
    state.cuSort = th.dataset.cuSort;
    $('cu-sort').value = state.cuSort;
    renderCustomers();
  });
});

// ── Wire up Product Paths filters ────────────────────────────────
let pathDebounce;
$('path-search').addEventListener('input', e => {
  clearTimeout(pathDebounce);
  pathDebounce = setTimeout(() => { state.pathSearch = e.target.value.trim(); renderPaths(); }, 200);
});

$('path-role').addEventListener('change', e => { state.pathRole = e.target.value; renderPaths(); });

$('path-minCount').addEventListener('input', e => {
  state.pathMin = parseInt(e.target.value, 10) || 0;
  renderPaths();
});

$('path-clear').addEventListener('click', () => {
  $('path-search').value   = '';
  $('path-role').value     = 'any';
  $('path-minCount').value = '';
  state.pathSearch = ''; state.pathRole = 'any'; state.pathMin = 0;
  renderPaths();
});

// ── Reporting page ────────────────────────────────────────────────
const PALETTE = ['#2563eb','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#ec4899','#6366f1','#14b8a6','#f97316','#0ea5e9','#a855f7'];
const GRID = 'rgba(148,163,184,0.18)';
const TICK = '#94a3b8';
const reportCharts = {};

function mkChart(id, config) {
  const ctx = $(id);
  if (!ctx) return;
  if (reportCharts[id]) { reportCharts[id].destroy(); delete reportCharts[id]; }
  reportCharts[id] = new Chart(ctx, config);
}
const moneyTick = v => '$' + (Math.abs(v) >= 1000 ? (v/1000).toFixed(v % 1000 ? 1 : 0) + 'k' : v);
const baseScales = (extra = {}) => Object.assign({
  x: { grid: { display: false }, ticks: { font: { size: 10 }, color: TICK } },
  y: { grid: { color: GRID }, ticks: { font: { size: 10 }, color: TICK }, beginAtZero: true },
}, extra);
const noLegend = { legend: { display: false } };
const legendBottom = { legend: { position: 'bottom', labels: { font: { size: 10 }, color: TICK, boxWidth: 10, padding: 8 } } };
const shorten = (s, n = 22) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const monthLbl = m => { const [y, mo] = String(m).split('-'); return new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }); };

// Mini SVG sparkline for a KPI card (gradient area + line + end dot).
function kpiSpark(vals, color) {
  const w = 240, h = 42;
  const data = (vals || []).map(v => (typeof v === 'number' && isFinite(v)) ? v : 0);
  if (data.length < 2) return '<div class="kpi-viz"></div>';
  const min = Math.min(...data), max = Math.max(...data), range = (max - min) || 1;
  const X = i => (i / (data.length - 1)) * w;
  const Y = v => h - 3 - ((v - min) / range) * (h - 7);
  const line = data.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
  const area = `M0 ${h} ` + data.map((v, i) => 'L' + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ') + ` L${w} ${h} Z`;
  const id = 'sp' + Math.random().toString(36).slice(2, 8);
  const lx = X(data.length - 1).toFixed(1), ly = Y(data[data.length - 1]).toFixed(1);
  return `<div class="kpi-viz"><svg class="kpi-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${lx}" cy="${ly}" r="2.6" fill="${color}"/></svg></div>`;
}
// Mini proportional split bar + legend for two-part KPIs.
function kpiSplit(parts) {
  const tot = parts.reduce((s, p) => s + (p.value > 0 ? p.value : 0), 0);
  const bar = tot > 0 ? parts.map(p => `<span style="width:${Math.max(0, p.value) / tot * 100}%;background:${p.color}"></span>`).join('') : '<span style="width:100%;background:var(--border)"></span>';
  const leg = parts.map(p => `<span><i style="background:${p.color}"></i>${escHtml(p.label)}</span>`).join('');
  return `<div class="kpi-viz"><div class="kpi-splitbar">${bar}</div><div class="kpi-splitleg">${leg}</div></div>`;
}

// Executive revenue snapshot — fixed periods (today / MTD / rolling 30d), business-wide
// (SamCart + Kajabi). Independent of the source selector + date range below.
async function renderRevenueKpis() {
  const grid = $('rev-kpis'); if (!grid) return;
  if (!grid.innerHTML) grid.innerHTML = '<div class="stat-card"><div class="stat-sub">Loading…</div></div>';
  if (!state.scData) await loadSamCart().catch(() => {});
  if (!state.kajabiData) { try { state.kajabiData = await api('/api/kajabi/data'); } catch { state.kajabiData = {}; } }
  if (!state.instagram)  { try { state.instagram  = await api('/api/instagram/data'); } catch { state.instagram = {}; } }
  if (!state.facebook)   { try { state.facebook   = await api('/api/facebook/data'); } catch { state.facebook = {}; } }
  ensureAdCampaigns();
  const sc = state.scData || {}, kj = state.kajabiData || {};
  const scD = sc.dailyRevenue || {}, kjD = kj.dailyRevenue || {};
  const now = nowET(), today = ymd(now);
  const monthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const monthDays = daysInRange(monthStart, today);
  const d30 = daysInRange(ymd(_addDays(today, -29)), today);
  const cell = (D, d, f) => (D[d] && D[d][f]) || 0;
  const sumR = (D, days) => Math.round(days.reduce((s, d) => s + cell(D, d, 'revenue'), 0) * 100) / 100;
  const sumO = (D, days) => days.reduce((s, d) => s + cell(D, d, 'orders'), 0);

  const revToday = cell(scD, today, 'revenue') + cell(kjD, today, 'revenue');
  const ordToday = cell(scD, today, 'orders') + cell(kjD, today, 'orders');
  const scMTD = sumR(scD, monthDays), kjMTD = sumR(kjD, monthDays);
  const revMTD = Math.round((scMTD + kjMTD) * 100) / 100;
  const ordMTD = sumO(scD, monthDays) + sumO(kjD, monthDays);
  const rev30 = Math.round((sumR(scD, d30) + sumR(kjD, d30)) * 100) / 100;
  const aov = ordMTD ? revMTD / ordMTD : 0;
  const camps = state.adCampaigns || [];
  // Prefer real Meta Ads spend (state.metaSpendByDay, last 90d) when connected; else manual campaign budgets.
  const metaDay = state.metaSpendByDay || null;
  const metaConnected = !!(metaDay && Object.keys(metaDay).length);
  const adSpendRange = (from, to) => metaConnected
    ? Math.round(daysInRange(from, to).reduce((s, d) => s + (metaDay[d] || 0), 0) * 100) / 100
    : Math.round(camps.reduce((s, c) => s + adSpend(c, from, to), 0) * 100) / 100;
  const adToday = adSpendRange(today, today);
  const adMTD = adSpendRange(monthStart, today);
  const roas = adMTD > 0 ? revMTD / adMTD : null;
  let paid = 0, organic = 0; const obc = sc.ordersByChannelByDay || {};
  for (const d of monthDays) { const e = obc[d]; if (!e) continue; for (const ch in e) { (/\bads?\b/i.test(ch) ? paid += e[ch].orders : organic += e[ch].orders); } }
  const acq = paid + organic;

  // New customers (first-ever purchase) in the last 90 days, + LTV:CAC
  const d90 = daysInRange(ymd(_addDays(today, -89)), today);
  const fob = sc.firstOrderByDay || {};
  const newCust90 = d90.reduce((s, d) => s + (fob[d] || 0), 0);
  const adSpend90 = adSpendRange(ymd(_addDays(today, -89)), today);
  const ltv = sc.avgLtv || 0;
  const cac = (newCust90 > 0 && adSpend90 > 0) ? adSpend90 / newCust90 : null;
  const ltvcac = (cac && ltv > 0) ? ltv / cac : null;
  const ig = (state.instagram && state.instagram.followers != null) ? state.instagram : null;
  const fb = (state.facebook && state.facebook.followers != null) ? state.facebook : null;

  // ── Daily series (last 30 days) for the sparklines ──
  const C = { blue: '#2563eb', green: '#16a34a', amber: '#f59e0b', violet: '#8b5cf6', pink: '#ec4899', fb: '#1877f2' };
  const combRev = d => cell(scD, d, 'revenue') + cell(kjD, d, 'revenue');
  const combOrd = d => cell(scD, d, 'orders') + cell(kjD, d, 'orders');
  const revSeries = d30.map(combRev);
  const ordSeries = d30.map(combOrd);
  const newSeries = d30.map(d => fob[d] || 0);
  const adSeries  = d30.map(d => metaConnected ? (metaDay[d] || 0) : camps.reduce((s, c) => s + adSpend(c, d, d), 0));
  const aovSeries = d30.map(d => { const o = combOrd(d); return o ? combRev(d) / o : 0; });
  const roasSeries = d30.map((d, i) => adSeries[i] > 0 ? revSeries[i] / adSeries[i] : 0);
  const igHist = ig ? Object.keys(ig.history || {}).sort().map(m => ig.history[m]) : [];
  const fbHist = fb ? Object.keys(fb.history || {}).sort().map(m => fb.history[m]) : [];

  const cards = [
    ['Revenue today', fmtMoney(revToday), 'SamCart + Kajabi · today (ET)', '', kpiSpark(revSeries, C.blue)],
    ['Revenue MTD', fmtMoney(revMTD), `month to date · ${fmtNum(ordMTD)} orders`, '', kpiSpark(revSeries, C.blue)],
    ['Orders today', fmtNum(ordToday), 'SamCart + Kajabi', '', kpiSpark(ordSeries, C.green)],
    ['ROAS MTD', roas != null ? roas.toFixed(2) + '×' : '—', adMTD > 0 ? `revenue ÷ ${fmtMoney(adMTD)} ${metaConnected ? 'Meta' : 'budget'} spend` : (metaConnected ? 'no Meta spend in range' : 'add ad budgets in Ads tab'), metaConnected ? 'Blended ROAS — real SamCart+Kajabi revenue ÷ live Meta ad spend (month to date).' : '', kpiSpark(roasSeries, C.violet)],
    ['Ad spend today', fmtMoney(adToday), metaConnected ? 'Meta Ads · today (ET)' : 'from campaign budgets', '', kpiSpark(adSeries, C.amber)],
    ['Revenue 30 days', fmtMoney(rev30), 'rolling 30 days', '', kpiSpark(revSeries, C.blue)],
    ['Avg order value', fmtMoney(aov), 'month to date', '', kpiSpark(aovSeries, C.blue)],
    ['LTV : CAC', ltvcac != null ? ltvcac.toFixed(1) + ' : 1' : '—', cac != null ? `LTV ${fmtMoney(ltv)} ÷ CAC ${fmtMoney(cac)}` : (metaConnected ? `avg LTV ${fmtMoney(ltv)}` : `avg LTV ${fmtMoney(ltv)} · add ad budgets`), 'Lifetime value ÷ customer-acquisition cost. CAC = ad spend ÷ new customers (last 90 days).', kpiSplit([{ label: 'LTV', value: ltv, color: C.green }, { label: 'CAC', value: cac || 0, color: C.amber }])],
    ['CAC (90d)', cac != null ? fmtMoney(cac) : '—', cac != null ? `${fmtMoney(adSpend90)} ÷ ${fmtNum(newCust90)} new` : (metaConnected ? 'no new customers in 90d' : 'add ad budgets in Ads tab'), 'Customer acquisition cost = ad spend ÷ new customers, last 90 days.', kpiSpark(adSeries, C.amber)],
    ['Revenue source MTD', fmtMoney(revMTD), `SamCart ${fmtMoney(scMTD)} · Kajabi ${fmtMoney(kjMTD)}`, '', kpiSplit([{ label: 'SamCart', value: scMTD, color: C.blue }, { label: 'Kajabi', value: kjMTD, color: C.violet }])],
    ['Acquisition MTD', acq ? Math.round(paid / acq * 100) + '% ads' : '—', acq ? `${Math.round(organic / acq * 100)}% organic · ${fmtNum(acq)} tagged orders` : 'needs UTM-tagged orders', 'Paid = orders from ad channels (FB Ads, etc.); organic = the rest, from UTM-attributed orders this month.', kpiSplit([{ label: 'Ads', value: paid, color: C.blue }, { label: 'Organic', value: organic, color: C.green }])],
    ['New customers (90d)', fmtNum(newCust90), 'first-time buyers · last 90 days', 'Customers whose first-ever purchase was in the last 90 days.', kpiSpark(newSeries, C.green)],
    ['IG followers gained', ig && ig.gainThisMonth != null ? '+' + fmtNum(ig.gainThisMonth) : (ig ? 'baseline set' : '—'), ig ? 'this month' : 'connect Instagram', ig && ig.gainThisMonth == null ? 'First month sets the baseline — next month shows the gain.' : 'New followers vs last month (Apify, refreshed monthly).', kpiSpark(igHist, C.pink)],
    ['Instagram followers', ig ? fmtNum(ig.followers) : '—', ig ? (ig.verified ? '✔ @' : '@') + ig.username : 'connect Instagram', 'Current follower count (Apify Instagram scraper, monthly).', kpiSpark(igHist, C.pink)],
    ['FB followers gained', fb && fb.gainThisMonth != null ? '+' + fmtNum(fb.gainThisMonth) : (fb ? 'baseline set' : '—'), fb ? 'this month' : 'connect Facebook', fb && fb.gainThisMonth == null ? 'First month sets the baseline — next month shows the gain.' : 'New Facebook followers vs last month (Apify, refreshed monthly).', kpiSpark(fbHist, C.fb)],
    ['Facebook followers', fb ? fmtNum(fb.followers) : '—', fb ? (fb.name || fb.pageName || 'Facebook page') : 'connect Facebook', 'Current Facebook page followers (Apify Facebook Pages scraper, monthly).', kpiSpark(fbHist, C.fb)],
  ];
  grid.innerHTML = cards.map(([l, v, s, h, viz]) =>
    `<div class="stat-card kpi-card"><div class="stat-label">${escHtml(l)}${h ? ` <span class="help" data-tip="${escHtml(h)}">?</span>` : ''}</div><div class="stat-value">${v}</div>${viz || ''}<div class="stat-sub">${escHtml(s)}</div></div>`
  ).join('');
}

async function loadReports() {
  // SamCart data drives most charts; ensure it's loaded, and fetch traffic trend + referrers.
  const tasks = [
    api('/api/analytics/trend?days=90').catch(() => []),
    api('/api/analytics/referrers').catch(() => []),
  ];
  if (!state.scData) tasks.push(loadSamCart().catch(() => {}));   // populate scData if not ready
  if (!state.funnelData) tasks.push(loadFunnel().catch(() => {}));
  if (!state.pagesData || !state.pagesData.length) tasks.push(loadPagesTable().catch(() => {}));
  const [trend, referrers] = await Promise.all(tasks);
  state.reportsTrend = trend;
  state.reportsReferrers = referrers;
  if (state.scData?.syncedAt) $('rep-syncedAt').textContent = (state.scData.isDemo ? 'Demo data' : 'Synced ' + timeAgo(state.scData.syncedAt));
  applyReportView();
  renderGoal();
  renderRevenueKpis().then(renderGoal);   // re-render once Kajabi MTD is loaded
}

// Source + date aware reporting. Summary KPIs + trend work for both sources from
// day-level data; detailed charts are source-specific.
function applyReportView() {
  const source = state.repSource || 'samcart';
  $('rep-samcart-extra').style.display = source === 'samcart' ? '' : 'none';
  $('rep-kajabi-extra').style.display  = source === 'kajabi' ? '' : 'none';
  if (source === 'kajabi') {
    if (!state.repKajabi) {
      api('/api/kajabi/data').then(d => { state.repKajabi = d; renderReportSummary('kajabi', d); renderReportKajabi(d); }).catch(() => {});
    } else { renderReportSummary('kajabi', state.repKajabi); renderReportKajabi(state.repKajabi); }
  } else {
    renderReportSummary('samcart', state.scData || {});
    if (state.scData) renderReports();
  }
}
function repSummaryData(d) {
  const s = state.repStart, e = state.repEnd;
  if (!s || !e) {   // all-time → totals + monthly trend
    return {
      revenue: d.totalRevenue || 0, orders: d.orderCount || 0, refunded: d.totalRefunded || 0,
      series: (d.monthly || []).map(m => ({ label: monthLbl(m.month), value: m.revenue })),
    };
  }
  const daily = d.dailyRevenue || {}, refDay = d.refundsByDay || {};
  let revenue = 0, orders = 0, refunded = 0; const series = [];
  for (const day of daysInRange(s, e)) {
    const x = daily[day], r = refDay[day] || 0;
    revenue += x ? x.revenue : 0; orders += x ? x.orders : 0; refunded += r;
    series.push({ label: day.slice(5), value: x ? x.revenue : 0 });
  }
  return { revenue: Math.round(revenue * 100) / 100, orders, refunded: Math.round(refunded * 100) / 100, series };
}
function renderReportSummary(source, d) {
  const sm = repSummaryData(d);
  const net = Math.round((sm.revenue - sm.refunded) * 100) / 100;
  const aov = sm.orders ? sm.revenue / sm.orders : 0;
  const label = source === 'kajabi' ? 'Kajabi Revenue' : 'Revenue';
  $('rep-summary').innerHTML = [
    [label, fmtMoney(sm.revenue), `${fmtNum(sm.orders)} orders`],
    ['Refunded', fmtMoney(sm.refunded), `net ${fmtMoney(net)}`],
    ['Avg Order Value', fmtMoney(aov), 'per order'],
    [source === 'kajabi' ? 'Contacts' : 'Customers', fmtNum(source === 'kajabi' ? (d.contactCount || 0) : (d.totalCustomers || 0)), 'all-time'],
  ].map(([l, v, s]) => `<div class="stat-card"><div class="stat-label">${l}</div><div class="stat-value">${v}</div><div class="stat-sub">${s}</div></div>`).join('');
  $('rep-trend-title').textContent = (state.repStart && state.repEnd) ? 'Revenue trend (daily)' : 'Revenue trend (monthly)';
  mkChart('rep-trend', {
    type: 'bar',
    data: { labels: sm.series.map(p => p.label), datasets: [{ label: 'Revenue', data: sm.series.map(p => p.value), backgroundColor: '#2563eb', borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmtMoney(c.raw) } } },
      scales: baseScales({ y: { grid: { color: GRID }, ticks: { font: { size: 10 }, color: TICK, callback: moneyTick }, beginAtZero: true } }) },
  });
}
function renderReportKajabi(d) {
  $('rep-kajabi-offers').innerHTML = (d.topOffers || []).slice(0, 10)
    .map(o => `<tr><td>${escHtml(o.title)}</td><td>${fmtNum(o.orders)}</td><td>${fmtMoney(o.revenue)}</td></tr>`).join('') || `<tr class="empty-row"><td colspan="3">—</td></tr>`;
  const e = d.engagement || {};
  $('rep-kajabi-engagement').innerHTML = [
    ['Login Rate', (e.loginRate || 0) + '%', `${fmtNum(e.loggedIn || 0)} of ${fmtNum(e.customers || 0)}`],
    ['Active (30d)', (e.activeRate || 0) + '%', `${fmtNum(e.active30 || 0)} members`],
  ].map(([l, v, s]) => `<div class="stat-card"><div class="stat-label">${l}</div><div class="stat-value">${v}</div><div class="stat-sub">${s}</div></div>`).join('');
}
$('rep-source').addEventListener('change', e => { state.repSource = e.target.value; applyReportView(); });
$('rep-range-preset').addEventListener('change', e => {
  const r = funnelPresetRange(e.target.value);
  if (r === undefined) { $('rep-start').focus(); return; }
  const [a, b] = r;
  state.repStart = a ? ymd(a) : ''; state.repEnd = b ? ymd(b) : '';
  $('rep-start').value = state.repStart; $('rep-end').value = state.repEnd;
  applyReportView();
});
function repApplyCustom() {
  $('rep-range-preset').value = 'custom';
  const a = $('rep-start').value, b = $('rep-end').value;
  if (a && b) { state.repStart = a <= b ? a : b; state.repEnd = a <= b ? b : a; } else { state.repStart = ''; state.repEnd = ''; }
  applyReportView();
}
$('rep-start').addEventListener('change', repApplyCustom);
$('rep-end').addEventListener('change', repApplyCustom);

function renderReports() {
  const d = state.scData;
  renderReportKpis(d);
  if (d) {
    const monthly = d.monthly || [];
    const mLabels = monthly.map(m => monthLbl(m.month));

    // 1) Revenue trend (area)
    mkChart('rep-revenue-trend', {
      type: 'line',
      data: { labels: mLabels, datasets: [{ label: 'Revenue', data: monthly.map(m => m.revenue), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.16)', fill: true, tension: 0.4, pointRadius: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { ...noLegend, tooltip: { callbacks: { label: c => ' ' + fmtMoney(c.raw) } } },
        scales: baseScales({ y: { grid: { color: GRID }, ticks: { font: { size: 10 }, color: TICK, callback: moneyTick }, beginAtZero: true } }) }
    });

    // 2) Orders vs AOV (bars + line, dual axis)
    mkChart('rep-orders-aov', {
      data: { labels: mLabels, datasets: [
        { type: 'bar', label: 'Orders', data: monthly.map(m => m.orders), backgroundColor: 'rgba(37,99,235,0.85)', borderRadius: 3, yAxisID: 'y' },
        { type: 'line', label: 'Avg Order Value', data: monthly.map(m => m.orders ? Math.round(m.revenue / m.orders) : 0), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', tension: 0.4, pointRadius: 2, yAxisID: 'y1' },
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: legendBottom,
        scales: { x: { grid: { display: false }, ticks: { font: { size: 10 }, color: TICK } },
          y: { position: 'left', grid: { color: GRID }, ticks: { font: { size: 10 }, color: TICK }, beginAtZero: true },
          y1: { position: 'right', grid: { display: false }, ticks: { font: { size: 10 }, color: '#f59e0b', callback: moneyTick }, beginAtZero: true } } }
    });

    // 3) Revenue by product (horizontal bar)
    const tp = (d.topProducts || []).slice(0, 10);
    mkChart('rep-revenue-product', {
      type: 'bar',
      data: { labels: tp.map(p => shorten(p.name)), datasets: [{ label: 'Revenue', data: tp.map(p => p.revenue), backgroundColor: '#2563eb', borderRadius: 3 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { ...noLegend, tooltip: { callbacks: { label: c => ' ' + fmtMoney(c.raw) } } },
        scales: { x: { grid: { color: GRID }, ticks: { font: { size: 10 }, color: TICK, callback: moneyTick }, beginAtZero: true }, y: { grid: { display: false }, ticks: { font: { size: 9 }, color: TICK } } } }
    });

    // 4) Units vs revenue per product (dual axis bars)
    mkChart('rep-units-revenue', {
      data: { labels: tp.map(p => shorten(p.name, 14)), datasets: [
        { type: 'bar', label: 'Units', data: tp.map(p => p.units), backgroundColor: 'rgba(16,185,129,0.85)', borderRadius: 3, yAxisID: 'y' },
        { type: 'bar', label: 'Revenue', data: tp.map(p => p.revenue), backgroundColor: 'rgba(37,99,235,0.85)', borderRadius: 3, yAxisID: 'y1' },
      ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: legendBottom,
        scales: { x: { grid: { display: false }, ticks: { font: { size: 8 }, color: TICK, maxRotation: 60, minRotation: 30 } },
          y: { position: 'left', grid: { color: GRID }, ticks: { font: { size: 10 }, color: '#10b981' }, beginAtZero: true },
          y1: { position: 'right', grid: { display: false }, ticks: { font: { size: 10 }, color: '#2563eb', callback: moneyTick }, beginAtZero: true } } }
    });

    // 5) Revenue share by slug (doughnut, top 7 + Other)
    const slugEntries = Object.entries(d.ordersBySlug || {}).map(([slug, v]) => ({ slug, revenue: v.revenue })).sort((a, b) => b.revenue - a.revenue);
    const top7 = slugEntries.slice(0, 7);
    const otherRev = slugEntries.slice(7).reduce((s, e) => s + e.revenue, 0);
    const slugLabels = top7.map(e => e.slug).concat(otherRev > 0 ? ['Other'] : []);
    const slugData = top7.map(e => e.revenue).concat(otherRev > 0 ? [otherRev] : []);
    mkChart('rep-revenue-slug', {
      type: 'doughnut',
      data: { labels: slugLabels, datasets: [{ data: slugData, backgroundColor: PALETTE, borderWidth: 0, hoverOffset: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'right', labels: { font: { size: 9 }, color: TICK, boxWidth: 9, padding: 6 } }, tooltip: { callbacks: { label: c => ' ' + c.label + ': ' + fmtMoney(c.raw) } } } }
    });

    // 6) Buyer mix (stacked horizontal bar)
    mkChart('rep-buyer-mix', {
      type: 'bar',
      data: { labels: ['Buyers'], datasets: [
        { label: 'Single', data: [d.singleBuyers], backgroundColor: '#e8a33d' },
        { label: 'Funnel (<24h)', data: [d.funnelBuyers], backgroundColor: '#2563eb' },
        { label: 'Ecosystem (≥24h)', data: [d.ecosystemBuyers], backgroundColor: '#10b981' },
      ] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: legendBottom,
        scales: { x: { stacked: true, grid: { color: GRID }, ticks: { font: { size: 10 }, color: TICK } }, y: { stacked: true, grid: { display: false }, ticks: { display: false } } } }
    });

    // 6b) Gross revenue vs refunds (monthly)
    if (d.refundRate != null) $('rep-refund-rate').textContent = `${fmtMoney(d.totalRefunded || 0)} refunded · ${d.refundRate}%`;
    mkChart('rep-refunds', {
      data: { labels: mLabels, datasets: [
        { type: 'bar',  label: 'Gross Revenue', data: monthly.map(m => m.revenue), backgroundColor: 'rgba(37,99,235,0.80)', borderRadius: 3, yAxisID: 'y' },
        { type: 'line', label: 'Refunds', data: monthly.map(m => m.refunds || 0), borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.12)', fill: true, tension: 0.35, pointRadius: 2, yAxisID: 'y' },
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { ...legendBottom, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtMoney(c.raw)}` } } },
        scales: baseScales({ y: { grid: { color: GRID }, ticks: { font: { size: 10 }, color: TICK, callback: moneyTick }, beginAtZero: true } }) }
    });

    // 7) LTV tiers (bars count + line total)
    const tiers = d.tiers || [];
    mkChart('rep-ltv-tiers', {
      data: { labels: tiers.map(t => t.label), datasets: [
        { type: 'bar', label: 'Customers', data: tiers.map(t => t.count), backgroundColor: 'rgba(37,99,235,0.85)', borderRadius: 3, yAxisID: 'y' },
        { type: 'line', label: 'Revenue', data: tiers.map(t => t.total), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', tension: 0.4, pointRadius: 3, yAxisID: 'y1' },
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: legendBottom,
        scales: { x: { grid: { display: false }, ticks: { font: { size: 10 }, color: TICK } },
          y: { position: 'left', grid: { color: GRID }, ticks: { font: { size: 10 }, color: '#2563eb' }, beginAtZero: true },
          y1: { position: 'right', grid: { display: false }, ticks: { font: { size: 10 }, color: '#10b981', callback: moneyTick }, beginAtZero: true } } }
    });

    // 8) Revenue concentration by tier (pie)
    mkChart('rep-revenue-tier-pie', {
      type: 'pie',
      data: { labels: tiers.map(t => t.label), datasets: [{ data: tiers.map(t => t.total), backgroundColor: PALETTE, borderWidth: 0, hoverOffset: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 9 }, color: TICK, boxWidth: 9, padding: 6 } }, tooltip: { callbacks: { label: c => ' ' + c.label + ': ' + fmtMoney(c.raw) } } } }
    });

    // 9) Top customers by LTV (horizontal bar)
    const tc = (d.topCustomers || []).slice(0, 12);
    mkChart('rep-top-customers', {
      type: 'bar',
      data: { labels: tc.map(c => shorten(c.name, 18)), datasets: [{ label: 'LTV', data: tc.map(c => c.ltv), backgroundColor: '#8b5cf6', borderRadius: 3 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { ...noLegend, tooltip: { callbacks: { label: c => ' ' + fmtMoney(c.raw), afterLabel: c => `${tc[c.dataIndex].orders} orders · ${tc[c.dataIndex].products} products` } } },
        scales: { x: { grid: { color: GRID }, ticks: { font: { size: 10 }, color: TICK, callback: moneyTick }, beginAtZero: true }, y: { grid: { display: false }, ticks: { font: { size: 9 }, color: TICK } } } }
    });

    // 10) Order depth vs value (bubble: x=orders, y=ltv, r=products)
    mkChart('rep-order-depth', {
      type: 'bubble',
      data: { datasets: [{ label: 'Customers', data: tc.map(c => ({ x: c.orders, y: c.ltv, r: 4 + (c.products || 1) * 2, _n: c.name })), backgroundColor: 'rgba(37,99,235,0.5)', borderColor: '#2563eb' }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { ...noLegend, tooltip: { callbacks: { label: c => `${c.raw._n}: ${c.raw.x} orders, ${fmtMoney(c.raw.y)}` } } },
        scales: { x: { title: { display: true, text: 'Orders', font: { size: 10 }, color: TICK }, grid: { color: GRID }, ticks: { font: { size: 10 }, color: TICK }, beginAtZero: true },
          y: { title: { display: true, text: 'LTV', font: { size: 10 }, color: TICK }, grid: { color: GRID }, ticks: { font: { size: 10 }, color: TICK, callback: moneyTick }, beginAtZero: true } } }
    });

    // 11) Cross-sell paths (horizontal bar)
    const paths = (d.productPaths || []).slice(0, 8);
    mkChart('rep-paths', {
      type: 'bar',
      data: { labels: paths.map(p => `${shorten(p.first, 16)} → ${shorten(p.second, 16)}`), datasets: [{ label: 'Customers', data: paths.map(p => p.count), backgroundColor: '#06b6d4', borderRadius: 3 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: noLegend,
        scales: { x: { grid: { color: GRID }, ticks: { font: { size: 10 }, color: TICK }, beginAtZero: true }, y: { grid: { display: false }, ticks: { font: { size: 9 }, color: TICK } } } }
    });
  }

  // 12) Traffic trend (line) — page analytics
  const trend = state.reportsTrend || [];
  mkChart('rep-traffic', {
    type: 'line',
    data: { labels: trend.map(r => new Date(r.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })), datasets: [
      { label: 'Views', data: trend.map(r => r.views), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.08)', fill: true, tension: 0.4, pointRadius: 0 },
      { label: 'Unique Visitors', data: trend.map(r => r.unique_visitors), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.06)', fill: true, tension: 0.4, pointRadius: 0 },
    ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: legendBottom, scales: baseScales({ x: { grid: { display: false }, ticks: { font: { size: 9 }, color: TICK, maxTicksLimit: 12 } } }) }
  });

  // 13) Channel -> visitors & revenue (dual-axis bars)
  renderChannelChart();

  // 14) Landing -> Checkout -> Purchase funnel (horizontal bar)
  const f = state.funnelData || {};
  const purchases = state.scData?.monthToDate?.orders || 0;
  mkChart('rep-funnel', {
    type: 'bar',
    data: { labels: ['Landing', 'Checkout', 'Purchase'], datasets: [{ label: 'Unique', data: [f.landingUnique || 0, f.checkoutUnique || 0, purchases], backgroundColor: ['#2563eb', '#06b6d4', '#10b981'], borderRadius: 3 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { ...noLegend, tooltip: { callbacks: { afterLabel: c => {
        const land = f.landingUnique || 0, chk = f.checkoutUnique || 0;
        if (c.dataIndex === 1 && land) return `${Math.round(chk / land * 1000) / 10}% of landing`;
        if (c.dataIndex === 2 && chk)  return `${Math.round(purchases / chk * 1000) / 10}% of checkout`;
        return '';
      } } } },
      scales: { x: { grid: { color: GRID }, ticks: { font: { size: 10 }, color: TICK }, beginAtZero: true }, y: { grid: { display: false }, ticks: { font: { size: 11 }, color: TICK } } } }
  });

  // 15) Top referrers (polar area, top 8 + Other)
  const refs = (state.reportsReferrers || []).slice();
  const top8 = refs.slice(0, 8);
  const otherVisits = refs.slice(8).reduce((s, r) => s + r.visits, 0);
  const refLabels = top8.map(r => shorten(r.source, 20)).concat(otherVisits ? ['Other'] : []);
  const refData = top8.map(r => r.visits).concat(otherVisits ? [otherVisits] : []);
  mkChart('rep-referrers', {
    type: 'polarArea',
    data: { labels: refLabels, datasets: [{ data: refData, backgroundColor: PALETTE.map(c => c + 'cc'), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 9 }, color: TICK, boxWidth: 9, padding: 5 } } }, scales: { r: { grid: { color: GRID }, ticks: { display: false } } } }
  });
}

// Channel -> visitors & attributed revenue (joins page analytics to SamCart orders)
function renderChannelChart() {
  const pages = state.pagesData || [];
  const byChannel = {};
  for (const p of pages) {
    if (isCheckoutPage(p.page_path, p.host)) continue;      // landing pages only
    const label = campaignName(p.page_path) || p.page_path;
    if (!byChannel[label]) byChannel[label] = { visitors: 0, revenue: 0 };
    byChannel[label].visitors += p.unique_visitors;
    const ord = ordersForSlug(slugKey(p.page_path));
    if (ord) byChannel[label].revenue += ord.revenue;
  }
  const rows = Object.entries(byChannel).map(([label, v]) => ({ label, ...v })).sort((a, b) => b.visitors - a.visitors).slice(0, 10);
  mkChart('rep-channel', {
    data: { labels: rows.map(r => r.label), datasets: [
      { type: 'bar', label: 'Unique Visitors', data: rows.map(r => r.visitors), backgroundColor: 'rgba(37,99,235,0.85)', borderRadius: 3, yAxisID: 'y' },
      { type: 'bar', label: 'Attributed Revenue', data: rows.map(r => r.revenue), backgroundColor: 'rgba(16,185,129,0.85)', borderRadius: 3, yAxisID: 'y1' },
    ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: legendBottom,
      scales: { x: { grid: { display: false }, ticks: { font: { size: 9 }, color: TICK } },
        y: { position: 'left', grid: { color: GRID }, ticks: { font: { size: 10 }, color: '#2563eb' }, beginAtZero: true },
        y1: { position: 'right', grid: { display: false }, ticks: { font: { size: 10 }, color: '#10b981', callback: moneyTick }, beginAtZero: true } } }
  });
}

function renderReportKpis(d) {
  const cards = [];
  if (d) {
    // 1) MoM momentum
    if (d.momRevenue != null) {
      const up = d.momRevenue >= 0;
      cards.push({ cls: up ? 'good' : 'bad', label: 'Month-over-Month', value: `${up ? '▲' : '▼'} ${Math.abs(d.momRevenue)}%`,
        text: `Revenue ${up ? 'grew' : 'fell'} and orders moved ${d.momOrders ?? 0}% in ${d.momLabel ? monthLbl(d.momLabel) : 'the last month'} vs. the prior month.` });
    }
    // 2) Revenue concentration (top 2 tiers = $500+)
    const t = d.tiers || [];
    if (t.length >= 6) {
      const topTotal = (t[4].total || 0) + (t[5].total || 0);
      const topCount = (t[4].count || 0) + (t[5].count || 0);
      const smallPct = (n, total) => { const p = total ? (n / total) * 100 : 0; return p > 0 && p < 1 ? '<1%' : Math.round(p) + '%'; };
      cards.push({ label: 'Revenue Concentration', value: smallPct(topTotal, d.totalRevenue),
        text: `of revenue comes from $500+ customers — just ${smallPct(topCount, d.totalCustomers)} of all buyers (${fmtNum(topCount)} people). A tiny VIP slice carries the business.` });
    }
    // 3) Repeat strength + mean/median gap
    cards.push({ label: 'Repeat Strength', value: `${d.repeatRate ?? 0}%`,
      text: `of customers buy again (${d.avgOrdersPerCustomer ?? 0} orders each). Avg LTV ${fmtMoneyFull(d.avgLtv)} vs. median ${fmtMoneyFull(d.medianLtv)} — a few big spenders pull the average up.` });
    // 4) Retention pattern — adaptive (engineered upsells vs. organic returns)
    const repeatTotal = (d.funnelBuyers || 0) + (d.ecosystemBuyers || 0);
    if (repeatTotal) {
      const funnelPct = Math.round((d.funnelBuyers / repeatTotal) * 100);
      if (funnelPct >= 50) {
        cards.push({ label: 'Retention Is Engineered', value: funnelPct + '%',
          text: `of repeat purchases happen within 24h as same-session upsells — your checkout sequence drives the repeats.` });
      } else {
        cards.push({ cls: 'good', label: 'Retention Is Organic', value: (100 - funnelPct) + '%',
          text: `of repeat purchases are genuine returns 24h+ later — only ${funnelPct}% are same-session upsells. Strong real loyalty.` });
      }
    }
    // 4b) Amount refunded
    if (d.totalRefunded != null) {
      cards.push({ cls: d.refundRate > 5 ? 'bad' : '', label: 'Amount Refunded', value: fmtMoney(d.totalRefunded),
        text: `${d.refundRate}% of gross revenue refunded across ${fmtNum(d.refundCount || 0)} refunds — net revenue is ${fmtMoney(d.netRevenue)}.` });
    }
    // 5) Visitor-to-customer conversion (only meaningful once tracking covers the sales window)
    const land = state.funnelData?.landingUnique || 0;
    const orders = d.monthToDate?.orders || 0;
    if (land && orders <= land) {
      cards.push({ label: 'Visitor → Customer', value: pct(orders, land),
        text: `of unique landing-page visitors became paying customers this month — the true end-to-end conversion rate.` });
    } else if (orders) {
      cards.push({ label: 'Visitor → Customer', value: 'Ramping',
        text: `Page tracking is newer than your SamCart history (${fmtNum(land)} tracked visitors vs. ${fmtNum(orders)} orders this month). This becomes accurate once a full month of traffic accrues.` });
    }
  }
  $('rep-kpis').innerHTML = cards.length ? cards.map(c => `
    <div class="kpi-card ${c.cls || ''}">
      <div class="kpi-label">${escHtml(c.label)}</div>
      <div class="kpi-value">${escHtml(c.value)}</div>
      <div class="kpi-text">${c.text}</div>
    </div>`).join('') : `<div class="kpi-card"><div class="kpi-text">Click <strong>Sync SamCart</strong> to populate sales insights.</div></div>`;
}

// ── Funnels (per-platform funnel builder, saved to Supabase) ──────
let _funnelSaveTimer = null;
// Standard channel set auto-added to every new group
const STANDARD_PLATFORMS = ['IG Posts', 'IG Stories', 'FB Posts', 'FB Stories', 'FB Group', 'Email', 'Tiktok', 'FB Ads'];
const DEFAULT_FUNNELS = STANDARD_PLATFORMS
  .map(p => ({ group: "Father's Day", platform: p, pageSlug: '', main: '', upsell1: '', upsell2: '' }));

const funnelExpanded = new Set();   // expanded group names (default: all collapsed)

function ensureFunnelsConfig() {
  if (!Array.isArray(state.funnelsConfig) || !state.funnelsConfig.length) {
    state.funnelsConfig = DEFAULT_FUNNELS.map(r => ({ ...r }));
  }
  state.funnelsConfig.forEach(r => { if (r.group == null) r.group = 'Ungrouped'; });
}
function funnelGroupNames() {
  ensureFunnelsConfig();
  const names = [];
  for (const r of state.funnelsConfig) if (!names.includes(r.group)) names.push(r.group);
  return names;
}
function uniqueGroupName(base) {
  const names = funnelGroupNames();
  if (!names.includes(base)) return base;
  let i = 2; while (names.includes(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

// slug -> { unique, checkout, label, isLanding } from tracked pages
function pageViewsMapFrom(pages) {
  const m = {};
  for (const e of buildSlugRows(pages || [])) {
    const isLanding = !!e.landingPath;
    // Landing → campaign label. Checkout → channel from the SamCart product (IG Posts,
    // FB Ads, …), falling back to the page title.
    const label = isLanding ? rowLabel(e) : (checkoutLabel(e.slug) || e.checkoutTitle || '');
    m[e.slug] = {
      unique: e.landingUnique, checkout: e.checkoutViews,
      label: label || `Checkout — ${titleCase(e.slug)}`,
      isLanding, hasTitle: isLanding || !!e.checkoutTitle || !!checkoutLabel(e.slug),
    };
  }
  return m;
}
// Use date-scoped pages when a funnel range is active, else all-time
function pageViewsMap() { return pageViewsMapFrom(state.funnelPages || state.pagesData || []); }

// Slug/product → {unique, checkout} keyed exactly like buildFunnelPages (landing by
// slug, products by name), for an arbitrary pages array — used for period comparison.
function slugStatsFrom(pages) {
  const pvm = pageViewsMapFrom(pages);
  const map = {};
  for (const sl of Object.keys(pvm)) if (pvm[sl].isLanding) map[sl] = { unique: pvm[sl].unique, checkout: pvm[sl].checkout };
  const list = (state.scData && state.scData.productList) || [];
  const ps   = (state.scData && state.scData.productSlug) || {};
  list.forEach(name => { const sl = ps[name]; const pv = (sl && pvm[sl]) || { unique: 0, checkout: 0 }; map[name] = { unique: pv.unique, checkout: pv.checkout }; });
  return map;
}
// Aggregate funnel metrics per group (+ total) for a period: page stats from slugStats,
// orders/revenue from SamCart day-level sales between start..end.
function funnelGroupMetrics(slugStats, start, end) {
  const cfg = state.funnelsConfig || [];
  const groups = {}; const channels = {}; const total = { U: 0, C: 0, M: 0, U1: 0, U2: 0, R: 0 };
  for (const r of cfg) {
    const pv = slugStats[r.pageSlug] || { unique: 0, checkout: 0 };
    const m  = prodSalesBetween(r.main, start, end);
    const u1 = prodSalesBetween(r.upsell1, start, end);
    const u2 = prodSalesBetween(r.upsell2, start, end);
    const mt = { U: pv.unique, C: pv.checkout, M: m.orders, U1: u1.orders, U2: u2.orders, R: m.revenue + u1.revenue + u2.revenue };
    const g = groups[r.group] || (groups[r.group] = { U: 0, C: 0, M: 0, U1: 0, U2: 0, R: 0 });
    for (const k of ['U', 'C', 'M', 'U1', 'U2', 'R']) { g[k] += mt[k]; total[k] += mt[k]; }
    (channels[r.group] = channels[r.group] || []).push(Object.assign({ label: r.platform || r.pageSlug || '—' }, mt));
  }
  return { groups, channels, total };
}
function prodSales(name) {
  const ps = state.scData && state.scData.productSales;
  return (name && ps && ps[name]) || { orders: 0, revenue: 0 };
}
// Days 'YYYY-MM-DD' between two dates (inclusive)
function daysInRange(s, e) {
  const out = []; let cur = new Date(s + 'T00:00:00'); const end = new Date(e + 'T00:00:00');
  let guard = 0;
  while (cur <= end && guard++ < 4000) { out.push(ymd(cur)); cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1); }
  return out;
}
// Sales for a product between two dates (inclusive); all-time when no range
function prodSalesBetween(name, start, end) {
  const sd = state.scData && state.scData.salesByDay;
  if (!start || !end || !sd) return prodSales(name);
  let o = 0, r = 0;
  for (const day of daysInRange(start, end)) {
    const e = sd[day] && sd[day][name];
    if (e) { o += e.orders; r += e.revenue; }
  }
  return { orders: o, revenue: Math.round(r * 100) / 100 };
}
// Sales for a product within the active funnel date range (else all-time)
function prodSalesInRange(name) { return prodSalesBetween(name, state.funnelStart, state.funnelEnd); }
const crPct = (n, d) => d > 0 ? Math.round((n / d) * 1000) / 10 + '%' : '—';

function productOptions(selected) {
  const list = (state.scData && state.scData.productList) || [];
  const names = (selected && !list.includes(selected)) ? [selected, ...list] : list;
  return '<option value="">— select —</option>' + names.map(n => {
    const s = prodSales(n).orders;
    return `<option value="${escHtml(n)}"${n === selected ? ' selected' : ''}>${escHtml(n)}${s ? ` (${fmtNum(s)})` : ''}</option>`;
  }).join('');
}
function pageOptions(selected, pvm) {
  // Keep landing pages + titled checkout/product pages; drop title-less gibberish.
  const keep = sl => pvm[sl].hasTitle || sl === selected;
  const opt = sl => `<option value="${escHtml(sl)}"${sl === selected ? ' selected' : ''}>${escHtml(pvm[sl].label || sl)} · /${escHtml(sl)}</option>`;
  const byLabel = (a, b) => (pvm[a].label || a).localeCompare(pvm[b].label || b);
  const landing  = Object.keys(pvm).filter(sl => keep(sl) && pvm[sl].isLanding).sort(byLabel);
  const checkout = Object.keys(pvm).filter(sl => keep(sl) && !pvm[sl].isLanding).sort(byLabel);
  const extra = (selected && !pvm[selected]) ? `<option value="${escHtml(selected)}" selected>${escHtml(selected)}</option>` : '';
  let html = '<option value="">— none —</option>' + extra;
  if (landing.length)  html += `<optgroup label="Landing pages">${landing.map(opt).join('')}</optgroup>`;
  if (checkout.length) html += `<optgroup label="Checkout / product pages">${checkout.map(opt).join('')}</optgroup>`;
  return html;
}

function groupOptions(selected) {
  const names = funnelGroupNames();
  if (selected && !names.includes(selected)) names.unshift(selected);
  return names.map(n => `<option value="${escHtml(n)}"${n === selected ? ' selected' : ''}>${escHtml(n)}</option>`).join('')
    + '<option value="__new__">＋ New group…</option>';
}

// Searchable page picker for funnels. Offers BOTH:
//  • landing pages — compact channel labels (e.g. "IG Posts"), key = slug
//  • products — deduped by title with views summed across variants, key = "prod::<title>"
// _funnelPages: key -> { label, unique, checkout, type }
let _funnelPages = {}, _pageDispToKey = {}, _keyToPageDisp = {};
function buildFunnelPages(pvm) {
  _funnelPages = {}; _pageDispToKey = {}; _keyToPageDisp = {};
  const used = {};
  const add = (key, label, unique, checkout, type) => {
    let disp = label;
    if (used[disp]) disp = `${disp} (${type === 'product' ? 'product' : key})`;
    used[disp] = true;
    _funnelPages[key] = { label: disp, unique, checkout, type };
    _pageDispToKey[disp] = key; _keyToPageDisp[key] = disp;
  };
  // Landing pages — per slug
  for (const sl of Object.keys(pvm)) {
    if (pvm[sl].isLanding) add(sl, pvm[sl].label, pvm[sl].unique, pvm[sl].checkout, 'landing');
  }
  // SamCart products (channel-specific, like SamCart's Sales by Product) — ALL of
  // them, the same set the Main Product picker shows. Keyed by product name; checkout
  // views are pulled from the tracked page carrying the product's slug (0 if untracked).
  const list = (state.scData && state.scData.productList) || [];
  const ps   = (state.scData && state.scData.productSlug) || {};
  list.forEach(name => {
    const sl = ps[name];
    const pv = (sl && pvm[sl]) || { unique: 0, checkout: 0 };
    add(name, name, pv.unique, pv.checkout, 'product');
  });
}
function pageViewsForKey(key) { return _funnelPages[key] || { unique: 0, checkout: 0 }; }
function pageDisplayForKey(key) { return key ? (_keyToPageDisp[key] || key) : ''; }
function pageValueToKey(v) {
  if (!v) return '';
  if (_pageDispToKey[v]) return _pageDispToKey[v];
  return v.trim();
}
function buildFunnelDatalists(pvm) {
  const products = (state.scData && state.scData.productList) || [];
  const pd = $('fn-products'); if (pd) pd.innerHTML = products.map(n => `<option value="${escHtml(n)}"></option>`).join('');
  buildFunnelPages(pvm);
  const pg = $('fn-pages');
  if (pg) {
    const keys = Object.keys(_funnelPages).sort((a, b) =>
      (_funnelPages[a].type === 'product') - (_funnelPages[b].type === 'product') ||
      _funnelPages[a].label.localeCompare(_funnelPages[b].label));
    pg.innerHTML = keys.map(k => `<option value="${escHtml(_funnelPages[k].label)}"></option>`).join('');
  }
}

function funnelMemberRow(r, i, pvm, agg) {
  const pv  = pageViewsForKey(r.pageSlug);
  const m   = prodSalesInRange(r.main), u1 = prodSalesInRange(r.upsell1), u2 = prodSalesInRange(r.upsell2);
  const rev = m.revenue + u1.revenue + u2.revenue;
  agg.U += pv.unique; agg.C += pv.checkout; agg.M += m.orders; agg.U1 += u1.orders; agg.U2 += u2.orders; agg.R += rev;
  return `
    <tr data-row="${i}" class="fn-member">
      <td><select class="fn-grp" data-field="group">${groupOptions(r.group)}</select></td>
      <td><input class="fn-input" data-field="platform" value="${escHtml(r.platform)}"></td>
      <td>
        <input class="fn-page" data-field="pageSlug" list="fn-pages" placeholder="Search page / product…" value="${escHtml(pageDisplayForKey(r.pageSlug))}" title="${escHtml(r.pageSlug || '')}">
        <div class="fn-sub">${fmtNum(pv.unique)} uniq · ${pv.checkout ? fmtNum(pv.checkout) : '0'} chk</div>
      </td>
      <td>
        <input class="fn-prod" data-field="main" list="fn-products" placeholder="Search product…" value="${escHtml(r.main || '')}">
        <div class="fn-sub"><span class="orders-count">${fmtNum(m.orders)}</span> · ${crPct(m.orders, pv.checkout)}</div>
      </td>
      <td>
        <input class="fn-prod" data-field="upsell1" list="fn-products" placeholder="Search product…" value="${escHtml(r.upsell1 || '')}">
        <div class="fn-sub"><span class="upsell-count">${fmtNum(u1.orders)}</span> · ${crPct(u1.orders, m.orders)}</div>
      </td>
      <td>
        <input class="fn-prod" data-field="upsell2" list="fn-products" placeholder="Search product…" value="${escHtml(r.upsell2 || '')}">
        <div class="fn-sub"><span class="upsell-count">${fmtNum(u2.orders)}</span> · ${crPct(u2.orders, u1.orders)}</div>
      </td>
      <td><span class="value-count">${fmtMoney(rev)}</span></td>
      <td><button class="fn-del" data-row="${i}" title="Remove platform">✕</button></td>
    </tr>`;
}

function renderFunnels() {
  ensureFunnelsConfig();
  const pvm = pageViewsMap();
  buildFunnelDatalists(pvm);
  const cfg = state.funnelsConfig;
  const grand = { U: 0, C: 0, M: 0, U1: 0, U2: 0, R: 0 };
  let html = '';

  for (const gname of funnelGroupNames()) {
    const idxs = cfg.map((_, i) => i).filter(i => cfg[i].group === gname);
    const g = { U: 0, C: 0, M: 0, U1: 0, U2: 0, R: 0 };
    const members = idxs.map(i => funnelMemberRow(cfg[i], i, pvm, g)).join('');
    grand.U += g.U; grand.C += g.C; grand.M += g.M; grand.U1 += g.U1; grand.U2 += g.U2; grand.R += g.R;
    const open = funnelExpanded.has(gname);
    html += `
      <tr class="fn-group-row" data-grp="${escHtml(gname)}">
        <td colspan="2" class="fn-grp-namecell" title="Click to ${open ? 'collapse' : 'expand'}">
          <div class="fn-grp-namewrap">
            <span class="fn-grp-drag" draggable="true" title="Drag to reorder">⠿</span>
            <button class="fn-grp-toggle" title="${open ? 'Collapse' : 'Expand'}">${open ? '▾' : '▸'}</button>
            <input class="fn-grp-name" data-grp="${escHtml(gname)}" value="${escHtml(gname)}" title="Rename group">
            <button class="fn-add-row" data-grp="${escHtml(gname)}" title="Add platform to this group">＋</button>
            <span class="group-count">${idxs.length}</span>
          </div>
        </td>
        <td class="fn-sub">${fmtNum(g.U)} uniq · ${fmtNum(g.C)} chk</td>
        <td><span class="orders-count">${fmtNum(g.M)}</span></td>
        <td><span class="upsell-count">${fmtNum(g.U1)}</span></td>
        <td><span class="upsell-count">${fmtNum(g.U2)}</span></td>
        <td><span class="value-count">${fmtMoney(g.R)}</span></td>
        <td><button class="fn-del-grp" data-grp="${escHtml(gname)}" title="Delete group">✕</button></td>
      </tr>`;
    if (open) html += members;
  }

  $('funnelBody').innerHTML = html || `<tr class="empty-row"><td colspan="8">No platforms yet — click “+ Group”.</td></tr>`;
  $('funnelFoot').innerHTML = cfg.length ? `
    <tr class="funnel-total">
      <td></td><td>TOTAL</td>
      <td class="fn-sub">${fmtNum(grand.U)} uniq · ${fmtNum(grand.C)} chk</td>
      <td><span class="orders-count">${fmtNum(grand.M)}</span></td>
      <td><span class="upsell-count">${fmtNum(grand.U1)}</span></td>
      <td><span class="upsell-count">${fmtNum(grand.U2)}</span></td>
      <td><span class="value-count">${fmtMoney(grand.R)}</span></td><td></td>
    </tr>` : '';
}

// ── Funnel comparison: current range vs the previous period of equal length ──
const _addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return d; };
async function renderFunnelCompare() {
  const card = $('fn-compare-card'); if (!card) return;
  if (!state.funnelCompare) { card.hidden = true; return; }
  card.hidden = false;
  const aS = state.funnelStart, aE = state.funnelEnd;
  if (!aS || !aE) {
    $('fn-compare-label').textContent = '';
    $('fn-compare-body').innerHTML = `<tr class="empty-row"><td colspan="6">Pick a date range above (e.g. Today or This week) to compare it with the period before.</td></tr>`;
    return;
  }
  const len = daysInRange(aS, aE).length;
  const bE = ymd(_addDays(aS, -1)), bS = ymd(_addDays(aS, -len));
  $('fn-compare-label').textContent = `${fmtRange(new Date(aS + 'T00:00:00'), new Date(aE + 'T00:00:00'))}  vs  ${fmtRange(new Date(bS + 'T00:00:00'), new Date(bE + 'T00:00:00'))}`;
  $('fn-compare-body').innerHTML = `<tr class="empty-row"><td colspan="6">Loading…</td></tr>`;
  let bPages = [];
  try { bPages = await api(`/api/analytics/pages?start=${bS}&end=${bE}`); } catch { /* ignore */ }
  const aM = funnelGroupMetrics(slugStatsFrom(state.funnelPages || []), aS, aE);
  const bM = funnelGroupMetrics(slugStatsFrom(bPages), bS, bE);
  renderCompareTable(aM, bM);
}
function renderCompareTable(aM, bM) {
  const cell = (a, b, money) => {
    const fa = money ? fmtMoney(a) : fmtNum(a);
    const fb = money ? fmtMoney(b) : fmtNum(b);
    let badge;
    if (b > 0) { const dv = Math.round(((a - b) / b) * 1000) / 10; badge = `<span class="delta ${dv >= 0 ? 'up' : 'down'}">${dv >= 0 ? '▲' : '▼'}${Math.abs(dv)}%</span>`; }
    else badge = a > 0 ? '<span class="delta up">new</span>' : '<span class="delta flat">—</span>';
    return `<div class="cmp-cur">${fa}</div><div class="cmp-prev">vs ${fb} ${badge}</div>`;
  };
  const empty = { U: 0, C: 0, M: 0, U1: 0, U2: 0, R: 0 };
  const row = (label, a, b, cls) => `<tr class="${cls || ''}"><td>${label}</td><td>${cell(a.U, b.U)}</td><td>${cell(a.C, b.C)}</td><td>${cell(a.M, b.M)}</td><td>${cell((a.U1 || 0) + (a.U2 || 0), (b.U1 || 0) + (b.U2 || 0))}</td><td>${cell(a.R, b.R, true)}</td></tr>`;
  const names = funnelGroupNames().filter(n => aM.groups[n] || bM.groups[n]);
  for (const n of [...Object.keys(aM.groups), ...Object.keys(bM.groups)]) if (!names.includes(n)) names.push(n);
  let html = '';
  for (const n of names) {
    html += row(`<strong>${escHtml(n)}</strong>`, aM.groups[n] || empty, bM.groups[n] || empty, 'cmp-group');
    const aCh = (aM.channels && aM.channels[n]) || [], bCh = (bM.channels && bM.channels[n]) || [];
    for (let i = 0; i < aCh.length; i++) html += row(`<span class="cmp-ch">↳ ${escHtml(aCh[i].label)}</span>`, aCh[i], bCh[i] || empty, 'cmp-channel');
  }
  html += row('<strong>TOTAL</strong>', aM.total, bM.total, 'funnel-total');
  $('fn-compare-body').innerHTML = html || `<tr class="empty-row"><td colspan="6">No data</td></tr>`;
}

function saveFunnels() {
  clearTimeout(_funnelSaveTimer);
  const pill = $('funnel-saved');
  pill.textContent = 'Saving…'; pill.className = 'pill';
  _funnelSaveTimer = setTimeout(async () => {
    try {
      const res  = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ funnels_config: JSON.stringify(state.funnelsConfig) }) });
      const body = await res.json().catch(() => ({}));
      // fetch() does NOT throw on HTTP errors, and an out-of-date server can return
      // success without persisting — so confirm funnels_config is in `updated`.
      if (!res.ok || !((body.updated || []).includes('funnels_config'))) throw new Error('not persisted');
      pill.textContent = 'Saved ✓'; pill.className = 'pill';
      setTimeout(() => { if (pill.textContent === 'Saved ✓') pill.textContent = ''; }, 2500);
    } catch {
      pill.textContent = '⚠ Not saved'; pill.className = 'pill pill-danger';
      pill.title = 'The server did not confirm the save. Your dashboard may be running an outdated build — redeploy the latest version.';
    }
  }, 600);
}

async function loadFunnels() {
  const tasks = [];
  if (!state.scData) tasks.push(loadSamCart().catch(() => {}));
  if (!state.pagesData || !state.pagesData.length) tasks.push(loadPagesTable().catch(() => {}));
  if (tasks.length) await Promise.all(tasks);
  renderFunnels();
  renderFunnelCompare();
}

// Apply the Funnels date range — refetch page views for the range, re-render
async function applyFunnelRange() {
  if (state.funnelStart && state.funnelEnd) {
    try { state.funnelPages = await api(`/api/analytics/pages?start=${state.funnelStart}&end=${state.funnelEnd}`); }
    catch { state.funnelPages = null; }
  } else { state.funnelPages = null; }
  renderFunnels();
  renderFunnelCompare();
}
// Resolve a preset to [startDate, endDate] (Date objects, or [null,null] for all-time)
function funnelPresetRange(v) {
  const now = nowET(), y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const mk = (yy, mm, dd) => new Date(yy, mm, dd);
  const weekOffset = (now.getDay() + 6) % 7;   // days since Monday (week starts Monday)
  switch (v) {
    case 'today':     return [mk(y, m, d), mk(y, m, d)];
    case 'yesterday': return [mk(y, m, d - 1), mk(y, m, d - 1)];
    case 'thisweek':  return [mk(y, m, d - weekOffset), mk(y, m, d)];
    case 'lastweek':  return [mk(y, m, d - weekOffset - 7), mk(y, m, d - weekOffset - 1)];
    case 'thismonth': return [mk(y, m, 1), mk(y, m, d)];
    case 'lastmonth': return [mk(y, m - 1, 1), mk(y, m, 0)];
    case 'thisyear':  return [mk(y, 0, 1), mk(y, m, d)];
    case 'all':       return [null, null];
    default:          return undefined;   // custom → leave inputs to the user
  }
}
$('fn-range-preset').addEventListener('change', e => {
  const r = funnelPresetRange(e.target.value);
  if (r === undefined) { $('fn-start').focus(); return; }   // custom
  const [s, en] = r;
  state.funnelStart = s ? ymd(s) : ''; state.funnelEnd = en ? ymd(en) : '';
  $('fn-start').value = state.funnelStart;   // auto-fill the visible inputs
  $('fn-end').value   = state.funnelEnd;
  applyFunnelRange();
});
function applyFunnelCustom() {
  $('fn-range-preset').value = 'custom';     // editing a date = custom range
  const s = $('fn-start').value, e = $('fn-end').value;
  if (s && e) { state.funnelStart = s <= e ? s : e; state.funnelEnd = s <= e ? e : s; }
  else { state.funnelStart = ''; state.funnelEnd = ''; }
  applyFunnelRange();
}
$('fn-start').addEventListener('change', applyFunnelCustom);
$('fn-end').addEventListener('change', applyFunnelCustom);
if ($('fn-compare-toggle')) $('fn-compare-toggle').addEventListener('click', () => {
  state.funnelCompare = !state.funnelCompare;
  $('fn-compare-toggle').classList.toggle('active', state.funnelCompare);
  renderFunnelCompare();
});

// Row + group edits (event delegation)
$('funnelBody').addEventListener('change', e => {
  // Row field (product / page / group selectors)
  const cell = e.target.closest('[data-field]'), tr = e.target.closest('[data-row]');
  if (cell && tr) {
    const i = +tr.dataset.row, f = cell.dataset.field;
    let v = e.target.value;
    if (f === 'group' && v === '__new__') v = uniqueGroupName('New Group');
    if (f === 'pageSlug') v = pageValueToKey(v);   // datalist display → slug or prod:: key
    state.funnelsConfig[i][f] = v;
    renderFunnels(); saveFunnels();
    return;
  }
  // Group rename
  const gn = e.target.closest('.fn-grp-name');
  if (gn) {
    const oldN = gn.dataset.grp, newN = e.target.value.trim() || oldN;
    if (newN !== oldN) {
      state.funnelsConfig.forEach(r => { if (r.group === oldN) r.group = newN; });
      if (funnelExpanded.has(oldN)) { funnelExpanded.delete(oldN); funnelExpanded.add(newN); }
      renderFunnels(); saveFunnels();
    }
  }
});
$('funnelBody').addEventListener('input', e => {
  if (!e.target.classList.contains('fn-input')) return;
  const tr = e.target.closest('[data-row]'); if (!tr) return;
  state.funnelsConfig[+tr.dataset.row].platform = e.target.value;
  saveFunnels();   // live-save platform name without re-render (keeps input focus)
});
$('funnelBody').addEventListener('click', e => {
  const del = e.target.closest('.fn-del');
  if (del) {
    const row = state.funnelsConfig[+del.dataset.row] || {};
    if (!confirm(`Remove the "${row.platform || 'this'}" platform row?`)) return;
    state.funnelsConfig.splice(+del.dataset.row, 1); renderFunnels(); saveFunnels(); return;
  }
  const addr = e.target.closest('.fn-add-row');
  if (addr) { state.funnelsConfig.push({ group: addr.dataset.grp, platform: 'New Platform', pageSlug: '', main: '', upsell1: '', upsell2: '' }); renderFunnels(); saveFunnels(); return; }
  const delg = e.target.closest('.fn-del-grp');
  if (delg) {
    const g = delg.dataset.grp, n = state.funnelsConfig.filter(r => r.group === g).length;
    if (!confirm(`Delete group "${g}" and its ${n} platform${n === 1 ? '' : 's'}? This cannot be undone.`)) return;
    state.funnelsConfig = state.funnelsConfig.filter(r => r.group !== g); renderFunnels(); saveFunnels(); return;
  }
  // Expand/collapse: clicking anywhere on the group row (except the rename box / drag handle) toggles it.
  if (e.target.closest('.fn-grp-name, .fn-grp-drag')) return;
  const grpRow = e.target.closest('.fn-group-row');
  if (grpRow) { const g = grpRow.dataset.grp; funnelExpanded.has(g) ? funnelExpanded.delete(g) : funnelExpanded.add(g); renderFunnels(); }
});

// ── Drag-and-drop to reorder funnel groups ──
let _fnDragGroup = null;
function reorderFunnelGroups(dragGroup, targetGroup) {
  if (!dragGroup || dragGroup === targetGroup) return;
  const order = funnelGroupNames().filter(g => g !== dragGroup);
  const ti = order.indexOf(targetGroup);
  if (ti < 0) return;
  order.splice(ti, 0, dragGroup);                                  // insert before the target group
  const cfg = state.funnelsConfig;
  state.funnelsConfig = order.flatMap(g => cfg.filter(r => r.group === g));
  renderFunnels(); saveFunnels();
}
$('funnelBody').addEventListener('dragstart', e => {
  const h = e.target.closest('.fn-grp-drag'); if (!h) { e.preventDefault(); return; }
  const row = h.closest('.fn-group-row'); _fnDragGroup = row && row.dataset.grp;
  e.dataTransfer.effectAllowed = 'move';
  if (row) row.classList.add('fn-dragging');
});
$('funnelBody').addEventListener('dragover', e => {
  if (!_fnDragGroup) return;
  const row = e.target.closest('.fn-group-row'); if (!row) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.fn-group-row.fn-drop-target').forEach(r => r.classList.remove('fn-drop-target'));
  if (row.dataset.grp !== _fnDragGroup) row.classList.add('fn-drop-target');
});
$('funnelBody').addEventListener('drop', e => {
  if (!_fnDragGroup) return;
  const row = e.target.closest('.fn-group-row'); if (!row) return;
  e.preventDefault(); reorderFunnelGroups(_fnDragGroup, row.dataset.grp); _fnDragGroup = null;
});
$('funnelBody').addEventListener('dragend', () => {
  _fnDragGroup = null;
  document.querySelectorAll('.fn-dragging, .fn-drop-target').forEach(r => r.classList.remove('fn-dragging', 'fn-drop-target'));
});
$('funnel-add').addEventListener('click', () => {
  ensureFunnelsConfig();
  state.funnelsConfig.push({ group: funnelGroupNames()[0] || 'Ungrouped', platform: 'New Platform', pageSlug: '', main: '', upsell1: '', upsell2: '' });
  renderFunnels(); saveFunnels();
});
// New group auto-fills the standard channel set (rename + add/remove as needed)
$('funnel-add-group').addEventListener('click', () => {
  const name = prompt('Name this group (e.g. a product or campaign):', 'New Group');
  if (name === null) return;   // cancelled
  const g = uniqueGroupName(name.trim() || 'New Group');
  STANDARD_PLATFORMS.forEach(p => state.funnelsConfig.push({ group: g, platform: p, pageSlug: '', main: '', upsell1: '', upsell2: '' }));
  renderFunnels(); saveFunnels();
});

// ══ Ads & ROAS ════════════════════════════════════════════════════
// A campaign: { name, platform, budgetType:'daily'|'total', budget, start, end, product }
function ensureAdCampaigns() {
  if (!Array.isArray(state.adCampaigns)) state.adCampaigns = [];
}
// Calculated spend for a campaign over [start,end] (inclusive). Daily = budget×days
// active in range; Total = budget prorated across the campaign's own run.
function adSpend(c, start, end) {
  const today = ymd(nowET());
  const cStart = c.start || start || '2000-01-01';
  const cEnd   = c.end   || today;                 // ongoing → up to today
  const rStart = start || cStart, rEnd = end || cEnd;
  const aStart = cStart > rStart ? cStart : rStart;   // overlap start (later)
  const aEnd   = cEnd   < rEnd   ? cEnd   : rEnd;      // overlap end (earlier)
  const days   = daysInRange(aStart, aEnd).length;    // 0 if no overlap
  if (days <= 0) return 0;
  const budget = parseFloat(c.budget) || 0;
  if (c.budgetType === 'total') {
    const campDays = daysInRange(cStart, cEnd).length || 1;
    return Math.round(budget * (days / campDays) * 100) / 100;
  }
  return Math.round(budget * days * 100) / 100;       // daily × days
}
const roasFmt = (rev, spend) => spend > 0 ? (Math.round((rev / spend) * 100) / 100) + '×' : '—';

function renderAds() {
  ensureAdCampaigns();
  // product picker datalist
  const prods = (state.scData && state.scData.productList) || [];
  const pd = $('ad-products'); if (pd) pd.innerHTML = prods.map(n => `<option value="${escHtml(n)}"></option>`).join('');

  const s = state.adStart, e = state.adEnd;
  const tot = { spend: 0, rev: 0, orders: 0 };
  const rowsHtml = state.adCampaigns.map((c, i) => {
    const spend = adSpend(c, s, e);
    const sales = prodSalesBetween(c.product, s, e);
    tot.spend += spend; tot.rev += sales.revenue; tot.orders += sales.orders;
    const cpa = sales.orders > 0 ? fmtMoney(spend / sales.orders) : '—';
    return `
      <tr data-arow="${i}" class="fn-member">
        <td><input class="fn-input" data-af="name" value="${escHtml(c.name || '')}" placeholder="Campaign name"></td>
        <td>
          <select class="fn-sel" data-af="budgetType">
            <option value="daily"${c.budgetType !== 'total' ? ' selected' : ''}>Daily</option>
            <option value="total"${c.budgetType === 'total' ? ' selected' : ''}>Total</option>
          </select>
          <div class="ad-budget"><span class="ad-cur">$</span><input class="fn-input ad-amt" type="number" min="0" step="1" data-af="budget" value="${escHtml(c.budget != null ? c.budget : '')}" placeholder="0"></div>
        </td>
        <td><input class="fn-input ad-date" type="date" data-af="start" value="${escHtml(c.start || '')}"><input class="fn-input ad-date" type="date" data-af="end" value="${escHtml(c.end || '')}" title="leave blank if ongoing"></td>
        <td>
          <input class="fn-prod" data-af="product" list="ad-products" placeholder="Search product…" value="${escHtml(c.product || '')}">
          <div class="fn-sub"><span class="orders-count">${fmtNum(sales.orders)}</span> orders</div>
        </td>
        <td><span class="value-count">${fmtMoney(spend)}</span><div class="fn-sub">${cpa}</div></td>
        <td><span class="value-count">${fmtMoney(sales.revenue)}</span></td>
        <td><span class="roas-badge ${spend > 0 && sales.revenue / spend >= 1 ? 'ok' : (spend > 0 ? 'bad' : '')}">${roasFmt(sales.revenue, spend)}</span></td>
        <td><button class="fn-del" data-arow="${i}" title="Remove campaign">✕</button></td>
      </tr>`;
  }).join('');

  $('adBody').innerHTML = rowsHtml || `<tr class="empty-row"><td colspan="8">No campaigns yet — click “+ Campaign”.</td></tr>`;
  $('adFoot').innerHTML = state.adCampaigns.length ? `
    <tr class="funnel-total">
      <td>TOTAL</td><td></td><td></td>
      <td><span class="orders-count">${fmtNum(tot.orders)}</span> orders</td>
      <td><span class="value-count">${fmtMoney(tot.spend)}</span></td>
      <td><span class="value-count">${fmtMoney(tot.rev)}</span></td>
      <td><span class="roas-badge ${tot.spend > 0 && tot.rev / tot.spend >= 1 ? 'ok' : (tot.spend > 0 ? 'bad' : '')}">${roasFmt(tot.rev, tot.spend)}</span></td>
      <td></td>
    </tr>` : '';

  // KPI cards
  const net = tot.rev - tot.spend;
  const pctRev = tot.rev > 0 ? Math.round((tot.spend / tot.rev) * 1000) / 10 + '%' : '—';
  $('ad-kpis').innerHTML = [
    ['Ad Spend', fmtMoney(tot.spend), 'selected range'],
    ['Revenue', fmtMoney(tot.rev), 'from linked products'],
    ['ROAS', roasFmt(tot.rev, tot.spend), 'revenue ÷ spend'],
    ['Net after spend', fmtMoney(net), `ad spend = ${pctRev} of revenue`],
  ].map(([l, v, sub]) => `<div class="stat-card"><div class="stat-label">${l}</div><div class="stat-value">${v}</div><div class="stat-sub">${sub}</div></div>`).join('');
}

let _adSaveTimer = null;
function saveAds() {
  clearTimeout(_adSaveTimer);
  const pill = $('ad-saved'); pill.textContent = 'Saving…'; pill.className = 'pill';
  _adSaveTimer = setTimeout(async () => {
    try {
      const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ad_campaigns: JSON.stringify(state.adCampaigns) }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !((body.updated || []).includes('ad_campaigns'))) throw new Error('not persisted');
      pill.textContent = 'Saved ✓';
      setTimeout(() => { if (pill.textContent === 'Saved ✓') pill.textContent = ''; }, 2500);
    } catch {
      pill.textContent = '⚠ Not saved'; pill.className = 'pill pill-danger';
      pill.title = 'The server did not confirm the save — the dashboard may be running an outdated build.';
    }
  }, 600);
}

// Date range control (mirrors the Funnels picker)
function applyAdRange() { renderAds(); }
$('ad-range-preset').addEventListener('change', e => {
  const r = funnelPresetRange(e.target.value);
  if (r === undefined) { $('ad-start').focus(); return; }
  const [a, b] = r;
  state.adStart = a ? ymd(a) : ''; state.adEnd = b ? ymd(b) : '';
  $('ad-start').value = state.adStart; $('ad-end').value = state.adEnd;
  applyAdRange();
});
function applyAdCustom() {
  $('ad-range-preset').value = 'custom';
  const a = $('ad-start').value, b = $('ad-end').value;
  if (a && b) { state.adStart = a <= b ? a : b; state.adEnd = a <= b ? b : a; } else { state.adStart = ''; state.adEnd = ''; }
  applyAdRange();
}
$('ad-start').addEventListener('change', applyAdCustom);
$('ad-end').addEventListener('change', applyAdCustom);

// Row edits
$('adBody').addEventListener('change', ev => {
  const cell = ev.target.closest('[data-af]'), tr = ev.target.closest('[data-arow]');
  if (!cell || !tr) return;
  state.adCampaigns[+tr.dataset.arow][cell.dataset.af] = ev.target.value;
  renderAds(); saveAds();
});
$('adBody').addEventListener('input', ev => {
  // live-save free-text/number without re-render (keep focus)
  const cell = ev.target.closest('[data-af]'), tr = ev.target.closest('[data-arow]');
  if (!cell || !tr) return;
  if (cell.dataset.af === 'name' || cell.dataset.af === 'budget') { state.adCampaigns[+tr.dataset.arow][cell.dataset.af] = ev.target.value; saveAds(); }
});
$('adBody').addEventListener('click', ev => {
  const del = ev.target.closest('.fn-del');
  if (!del) return;
  const c = state.adCampaigns[+del.dataset.arow] || {};
  if (!confirm(`Remove the "${c.name || 'this'}" campaign?`)) return;
  state.adCampaigns.splice(+del.dataset.arow, 1); renderAds(); saveAds();
});
$('ad-add').addEventListener('click', () => {
  ensureAdCampaigns();
  state.adCampaigns.push({ name: 'New campaign', platform: 'Meta', budgetType: 'daily', budget: '', start: state.adStart || '', end: '', product: '' });
  renderAds(); saveAds();
});

async function loadAds() {
  if (!state.adStart && !state.adEnd) {            // default to This month
    const [a, b] = funnelPresetRange('thismonth');
    state.adStart = ymd(a); state.adEnd = ymd(b);
    $('ad-start').value = state.adStart; $('ad-end').value = state.adEnd;
  }
  if (!state.scData) await loadSamCart().catch(() => {});
  renderAds();
  loadMetaAds();
}

// ── Meta (Facebook) Ads reporting ─────────────────────────────────
const metaMoney = (v, cur) => { const n = Number(v) || 0; try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD', minimumFractionDigits: 0, maximumFractionDigits: Math.abs(n) < 100 && n !== 0 ? 2 : 0 }).format(n); } catch { return '$' + n.toFixed(2); } };
function metaConnectHtml() {
  return `<div class="meta-connect">
    <div class="meta-connect-icon">📊</div>
    <h3>Connect Meta (Facebook) Ads</h3>
    <p>Add your <strong>Meta Ad Account ID</strong> and a <strong>System User access token</strong> in Settings to pull live spend, ROAS, CPM / CPC / CTR and per-campaign performance here — read-only, never expires.</p>
    <button class="btn-primary sm" id="meta-goto-settings" type="button">Open Settings</button>
  </div>`;
}
async function loadMetaAds(force) {
  const body = $('meta-ads-body'); if (!body) return;
  const preset = ($('meta-range') && $('meta-range').value) || 'last30';
  if (!body.dataset.loaded) body.innerHTML = '<div class="soc-empty">Loading Meta Ads…</div>';
  try {
    const d = await api(`/api/meta-ads/data?preset=${encodeURIComponent(preset)}${force ? '&force=1' : ''}`);
    state.metaAds = d; renderMetaAds(d); body.dataset.loaded = '1';
  } catch (e) { body.innerHTML = `<div class="meta-connect"><p>⚠ ${escHtml((e && e.message) || 'Could not load Meta Ads')}</p></div>`; }
}
function renderMetaAds(d) {
  const body = $('meta-ads-body'); if (!body) return;
  if (!d || d.configured === false) { if ($('meta-acct-label')) $('meta-acct-label').textContent = '· not connected'; if ($('meta-synced')) $('meta-synced').textContent = ''; body.innerHTML = metaConnectHtml(); return; }
  if (d.error) { if ($('meta-synced')) $('meta-synced').textContent = ''; body.innerHTML = `<div class="meta-connect"><div class="meta-connect-icon">⚠</div><h3>Meta API error</h3><p>${escHtml(d.error)}</p><p class="th-hint">Check the ad account ID & token in Settings (the token needs <code>ads_read</code> on this account).</p></div>`; return; }
  const t = d.totals || {}, cur = d.currency || 'USD', money = v => metaMoney(v, cur);
  if ($('meta-acct-label')) $('meta-acct-label').textContent = d.account ? '· ' + (d.account.name || d.account.id || '') : '';
  if ($('meta-synced')) $('meta-synced').textContent = d.syncedAt ? 'Updated ' + timeAgo(d.syncedAt) : '';
  const kpis = [
    ['Spend', money(t.spend)], ['Revenue', money(t.revenue)], ['ROAS', (t.roas || 0).toFixed(2) + '×'],
    ['Purchases', fmtNum(t.purchases)], ['Cost / purchase', t.cpa ? money(t.cpa) : '—'],
    ['Impressions', fmtNum(t.impressions)], ['Reach', fmtNum(t.reach)], ['Clicks', fmtNum(t.clicks)],
    ['CTR', (t.ctr || 0).toFixed(2) + '%'], ['CPC', money(t.cpc)], ['CPM', money(t.cpm)], ['Frequency', (t.frequency || 0).toFixed(2)],
  ];
  const kpiHtml = `<div class="rf-cards meta-kpis">${kpis.map(([l, v]) => `<div class="rf-card"><div class="rf-card-label">${l}</div><div class="rf-card-val">${v}</div></div>`).join('')}</div>`;
  const trendHtml = `<div class="card meta-trend"><div class="chart-card-head"><h3>Spend &amp; ROAS — last 90 days</h3></div><div class="chart-wrap"><canvas id="meta-trend-chart"></canvas></div></div>`;
  const camps = d.campaigns || [];
  const tableHtml = `<div class="card"><div class="card-header"><h2>Campaigns <span class="th-hint">by spend</span></h2></div><div class="table-wrap"><table class="data-table meta-table">
    <thead><tr><th>Campaign</th><th class="soc-mh">Spend</th><th class="soc-mh">Impr.</th><th class="soc-mh">Clicks</th><th class="soc-mh">CTR</th><th class="soc-mh">CPC</th><th class="soc-mh">CPM</th><th class="soc-mh">Purch.</th><th class="soc-mh">Revenue</th><th class="soc-mh">ROAS</th></tr></thead>
    <tbody>${camps.length ? camps.map(c => `<tr><td class="meta-cname" title="${escHtml(c.name)}">${escHtml(c.name)}</td><td class="soc-metric">${money(c.spend)}</td><td class="soc-metric">${fmtNum(c.impressions)}</td><td class="soc-metric">${fmtNum(c.clicks)}</td><td class="soc-metric">${(c.ctr || 0).toFixed(2)}%</td><td class="soc-metric">${money(c.cpc)}</td><td class="soc-metric">${money(c.cpm)}</td><td class="soc-metric">${fmtNum(c.purchases)}</td><td class="soc-metric">${money(c.revenue)}</td><td class="soc-metric ${c.roas >= 1 ? 'meta-good' : 'meta-bad'}">${(c.roas || 0).toFixed(2)}×</td></tr>`).join('') : '<tr class="empty-row"><td colspan="10">No campaign spend in this range.</td></tr>'}</tbody>
  </table></div></div>`;
  body.innerHTML = kpiHtml + trendHtml + tableHtml;
  const daily = d.daily || [];
  state.metaSpendByDay = {}; for (const x of daily) if (x.date_start) state.metaSpendByDay[x.date_start] = x.spend || 0;
  mkChart('meta-trend-chart', {
    type: 'bar',
    data: { labels: daily.map(x => x.date_start), datasets: [
      { type: 'bar', label: 'Spend', data: daily.map(x => x.spend), backgroundColor: '#4267B2', yAxisID: 'y', borderRadius: 3, order: 2 },
      { type: 'line', label: 'ROAS', data: daily.map(x => x.roas), borderColor: '#10b981', backgroundColor: 'transparent', yAxisID: 'y1', tension: 0.3, pointRadius: 0, borderWidth: 2, order: 1 },
    ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: TICK, font: { size: 11 } } }, tooltip: { callbacks: { label: c => c.dataset.label === 'ROAS' ? ` ROAS ${(c.parsed.y || 0).toFixed(2)}×` : ` Spend ${money(c.parsed.y)}` } } }, scales: {
      x: { grid: { display: false }, ticks: { color: TICK, font: { size: 9 }, maxTicksLimit: 12 } },
      y: { position: 'left', grid: { color: GRID }, ticks: { color: TICK, font: { size: 10 }, callback: v => money(v) }, beginAtZero: true },
      y1: { position: 'right', grid: { display: false }, ticks: { color: TICK, font: { size: 10 }, callback: v => v + '×' }, beginAtZero: true },
    } },
  });
}
if ($('meta-range')) $('meta-range').addEventListener('change', () => { const b = $('meta-ads-body'); if (b) b.dataset.loaded = ''; loadMetaAds(); });
if ($('meta-refresh')) $('meta-refresh').addEventListener('click', () => { const b = $('meta-ads-body'); if (b) b.dataset.loaded = ''; loadMetaAds(true); });
if ($('meta-ads-block')) $('meta-ads-block').addEventListener('click', e => { if (e.target.closest('#meta-goto-settings')) activateTab('settings'); });
// Lightweight loader for the Overview KPIs: pull Meta's 90-day daily spend → state.metaSpendByDay.
async function loadMetaSpend() {
  try {
    const d = await api('/api/meta-ads/data?preset=last30');
    if (d && d.configured && !d.error && Array.isArray(d.daily) && d.daily.length) {
      const map = {}; for (const x of d.daily) if (x.date_start) map[x.date_start] = x.spend || 0;
      state.metaSpendByDay = map;
    } else if (d && d.configured === false) { state.metaSpendByDay = null; }
  } catch {}
  if (state.scData) renderSalesAnalytics(state.scData);   // re-render Overview KPIs with real Meta spend
}

// ══ Kajabi (reporting) ════════════════════════════════════════════
async function loadKajabi() {
  try { const d = await api('/api/kajabi/data'); state.kajabiData = d; renderKajabi(d); }
  catch (e) { $('kajabi-status').textContent = 'Error loading'; }
}
// Lightweight fetch (no chart render) so the Monthly Goal + Overview revenue can include Kajabi at boot
async function loadKajabiData() {
  try { state.kajabiData = await api('/api/kajabi/data'); renderGoal(); renderOverviewRevenue(); } catch {}
}
function renderKajabi(d) {
  const unconf = $('kajabi-unconfigured'), content = $('kajabi-content');
  if (!d || d.configured === false) {
    unconf.style.display = ''; content.style.display = 'none';
    $('kajabi-status').textContent = 'Not connected';
    return;
  }
  unconf.style.display = 'none'; content.style.display = '';
  $('kajabi-status').textContent = (d.syncedAt ? 'Synced ' + timeAgo(d.syncedAt) : '') + (d.stale ? ' · stale' : '');

  const subs = d.subscriptions || {}, eng = d.engagement || {};
  $('kajabi-kpis').innerHTML = [
    ['Kajabi Revenue', fmtMoney(d.totalRevenue), `${fmtNum(d.orderCount)} orders`],
    ['Refunded', fmtMoney(d.totalRefunded || 0), `${fmtNum(d.refundCount || 0)} refunds`],
    ['Net Revenue', fmtMoney(d.netRevenue != null ? d.netRevenue : d.totalRevenue), 'after refunds'],
    ['Avg Order Value', fmtMoney(d.avgOrderValue), 'net paid per order'],
    ['Contacts', fmtNum(d.contactCount || 0), 'total audience'],
    ['Purchases', fmtNum(d.purchaseCount || 0), `${fmtNum(subs.active || 0)} active subscriptions`],
    ['Login Rate', (eng.loginRate || 0) + '%', `${fmtNum(eng.loggedIn || 0)} of ${fmtNum(eng.customers || 0)} ever logged in`],
    ['Active (30d)', (eng.activeRate || 0) + '%', `${fmtNum(eng.active30 || 0)} members active`],
  ].map(([l, v, s]) => `<div class="stat-card"><div class="stat-label">${l}</div><div class="stat-value">${v}</div><div class="stat-sub">${s}</div></div>`).join('');

  const m = d.monthly || [];
  mkChart('kajabiMonthlyChart', {
    type: 'bar',
    data: { labels: m.map(x => x.month), datasets: [{ label: 'Revenue', data: m.map(x => x.revenue), backgroundColor: '#2563eb', borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: baseScales({ y: { grid: { color: GRID }, ticks: { font: { size: 10 }, color: TICK, callback: moneyTick } } }) },
  });

  $('kajabiOffers').innerHTML = (d.topOffers || []).slice(0, 12)
    .map(o => `<tr><td>${escHtml(o.title)}</td><td>${fmtNum(o.orders)}</td><td>${fmtMoney(o.revenue)}</td></tr>`).join('')
    || `<tr class="empty-row"><td colspan="3">No offers</td></tr>`;
  $('kajabiRecent').innerHTML = (d.recent || [])
    .map(r => `<tr><td>${escHtml(r.customer || ('#' + r.order))}</td><td>${escHtml(String(r.date || '').slice(0, 10))}</td><td>${fmtMoney(r.total)}</td></tr>`).join('')
    || `<tr class="empty-row"><td colspan="3">No recent orders</td></tr>`;
}
$('kajabi-sync').addEventListener('click', async () => {
  const btn = $('kajabi-sync'); btn.disabled = true; $('kajabi-status').textContent = 'Syncing…';
  try {
    await fetch('/api/kajabi/sync', { method: 'POST' });
    const poll = setInterval(async () => {
      const s = await api('/api/kajabi/sync/status').catch(() => ({}));
      if (s.running === false) { clearInterval(poll); btn.disabled = false; loadKajabi(); }
      else if (s.phase) $('kajabi-status').textContent = `Syncing ${s.phase}… ${fmtNum(s.count || 0)}`;
    }, 2500);
  } catch { btn.disabled = false; $('kajabi-status').textContent = 'Sync failed'; }
});

// ══ Email (ActiveCampaign) ════════════════════════════════════════
async function loadEmail() {
  try { renderEmail(await api('/api/ac/data')); }
  catch { $('email-status').textContent = 'Error loading'; }
}
function renderEmail(d) {
  const unconf = $('email-unconfigured'), content = $('email-content');
  if (!d || d.configured === false) {
    unconf.style.display = ''; content.style.display = 'none';
    $('email-status').textContent = 'Not connected'; return;
  }
  unconf.style.display = 'none'; content.style.display = '';
  $('email-status').textContent = (d.syncedAt ? 'Synced ' + timeAgo(d.syncedAt) : '') + (d.stale ? ' · stale' : '');

  const dl = d.deliverability || {}, c = d.contacts || {}, a = d.automations || {};
  $('email-kpis').innerHTML = [
    ['Avg Open Rate', dl.avgOpenRate + '%', `${fmtNum(dl.campaigns || 0)} campaigns`],
    ['Avg Click Rate', dl.avgClickRate + '%', `click-to-open ${dl.avgCtor || 0}%`],
    ['Delivery Rate', dl.deliveryRate + '%', `${fmtNum(dl.totalBounces || 0)} bounces`],
    ['Unsub / Send', dl.unsubRate + '%', `${fmtNum(dl.totalUnsubs || 0)} unsubscribes`],
    ['Active Subscribers', fmtNum(c.active || 0), `${c.activeRate || 0}% of ${fmtNum(c.total || 0)}`],
    ['Unsubscribed', fmtNum(c.unsubscribed || 0), `${c.unsubRate || 0}% of list (lifetime)`],
    ['Active Automations', fmtNum(a.active || 0), `${fmtNum(a.total || 0)} total`],
    ['Emails Sent', fmtNum(dl.sent || 0), 'analyzed campaigns'],
  ].map(([l, v, s]) => `<div class="stat-card"><div class="stat-label">${l}</div><div class="stat-value">${v}</div><div class="stat-sub">${s}</div></div>`).join('');

  const m = d.monthly || [];
  const shortName = s => { s = String(s || ''); return s.length > 20 ? s.slice(0, 20) + '…' : s; };
  const pctOf = (n, dn) => dn ? Math.round((n / dn) * 1000) / 10 : 0;
  const pctY = { ticks: { font: { size: 9 }, color: TICK, callback: v => v + '%' } };
  const kY   = { font: { size: 9 }, color: TICK, callback: v => v >= 1000 ? (v / 1000) + 'k' : v };
  const lgnd = { labels: { font: { size: 10 }, color: TICK, boxWidth: 10 } };

  mkChart('emailTrendChart', {
    data: { labels: m.map(x => x.month), datasets: [
      { type: 'bar', label: 'Sent', data: m.map(x => x.sent), backgroundColor: 'rgba(37,99,235,0.4)', borderRadius: 4, yAxisID: 'y' },
      { type: 'line', label: 'Open %', data: m.map(x => x.openRate), borderColor: '#10b981', backgroundColor: '#10b981', tension: 0.3, pointRadius: 2, yAxisID: 'y1' },
      { type: 'line', label: 'Click %', data: m.map(x => x.clickRate), borderColor: '#f59e0b', backgroundColor: '#f59e0b', tension: 0.3, pointRadius: 2, yAxisID: 'y1' },
    ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: lgnd },
      scales: { x: { grid: { display: false }, ticks: { font: { size: 9 }, color: TICK } },
        y: { position: 'left', grid: { color: GRID }, ticks: kY, beginAtZero: true },
        y1: { position: 'right', grid: { display: false }, ...pctY, min: 0, max: 100 } } },
  });

  // Engagement funnel — Sent → Delivered → Opened → Clicked
  const fl = [['Sent', dl.sent || 0], ['Delivered', dl.delivered || 0], ['Opened', dl.opened || 0], ['Clicked', dl.clicked || 0]];
  mkChart('emailFunnelChart', {
    type: 'bar',
    data: { labels: fl.map(x => x[0]), datasets: [{ data: fl.map(x => x[1]), backgroundColor: ['#2563eb', '#10b981', '#06b6d4', '#f59e0b'], borderRadius: 6 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmtNum(c.raw) } } },
      scales: { x: { grid: { color: GRID }, ticks: kY }, y: { grid: { display: false }, ticks: { font: { size: 11 }, color: TICK } } } },
  });
  $('email-funnel-note').textContent = `Of ${fmtNum(dl.sent || 0)} sent: ${pctOf(dl.delivered, dl.sent)}% delivered · ${pctOf(dl.opened, dl.sent)}% opened · ${pctOf(dl.clicked, dl.sent)}% clicked`;

  // Campaign status mix
  const sc = d.campaignStatusCounts || {}; const slabels = Object.keys(sc);
  mkChart('emailStatusChart', {
    type: 'doughnut',
    data: { labels: slabels, datasets: [{ data: slabels.map(l => sc[l]), backgroundColor: PALETTE, borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 10 }, color: TICK, boxWidth: 10, padding: 6 } } }, cutout: '58%' },
  });

  // Recent campaigns — Open vs Click (last 12 sent, chronological)
  const sentCamps = (d.campaigns || []).filter(c => c.sent);
  const recent = sentCamps.slice(0, 12).reverse();
  mkChart('emailCompareChart', {
    type: 'bar',
    data: { labels: recent.map(c => shortName(c.name)), datasets: [
      { label: 'Open %', data: recent.map(c => c.openRate), backgroundColor: '#2563eb', borderRadius: 4 },
      { label: 'Click %', data: recent.map(c => c.clickRate), backgroundColor: '#10b981', borderRadius: 4 },
    ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: lgnd },
      scales: { x: { grid: { display: false }, ticks: { font: { size: 8 }, color: TICK, maxRotation: 60, minRotation: 45 } }, y: { grid: { color: GRID }, ...pctY, beginAtZero: true } } },
  });

  // Top campaigns by open rate (min 50 recipients)
  const topOpen = sentCamps.filter(c => c.recipients >= 50).sort((a, b) => b.openRate - a.openRate).slice(0, 8).reverse();
  mkChart('emailTopOpenChart', {
    type: 'bar',
    data: { labels: topOpen.map(c => shortName(c.name)), datasets: [{ data: topOpen.map(c => c.openRate), backgroundColor: '#2563eb', borderRadius: 4 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + c.raw + '%' } } },
      scales: { x: { grid: { color: GRID }, ...pctY }, y: { grid: { display: false }, ticks: { font: { size: 9 }, color: TICK } } } },
  });

  // Top automations by contacts entered
  const topAuto = ((a.list) || []).slice(0, 8).reverse();
  mkChart('emailTopAutoChart', {
    type: 'bar',
    data: { labels: topAuto.map(x => shortName(x.name)), datasets: [{ data: topAuto.map(x => x.entered), backgroundColor: '#8b5cf6', borderRadius: 4 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmtNum(c.raw) + ' entered' } } },
      scales: { x: { grid: { color: GRID }, ticks: kY }, y: { grid: { display: false }, ticks: { font: { size: 9 }, color: TICK } } } },
  });

  // Unsubscribe & bounce rate trend
  mkChart('emailDelivChart', {
    data: { labels: m.map(x => x.month), datasets: [
      { type: 'line', label: 'Unsub %', data: m.map(x => x.unsubRate), borderColor: '#f59e0b', backgroundColor: '#f59e0b', tension: 0.3, pointRadius: 2 },
      { type: 'line', label: 'Bounce %', data: m.map(x => x.bounceRate), borderColor: '#ef4444', backgroundColor: '#ef4444', tension: 0.3, pointRadius: 2 },
    ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: lgnd },
      scales: { x: { grid: { display: false }, ticks: { font: { size: 9 }, color: TICK } }, y: { grid: { color: GRID }, ...pctY, beginAtZero: true } } },
  });

  mkChart('emailListChart', {
    type: 'doughnut',
    data: { labels: ['Active', 'Unsubscribed', 'Bounced'], datasets: [{ data: [c.active || 0, c.unsubscribed || 0, c.bounced || 0], backgroundColor: ['#10b981', '#f59e0b', '#ef4444'], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 10 }, color: TICK, boxWidth: 10, padding: 6 } } }, cutout: '60%' },
  });
  $('email-list-note').textContent = `${fmtNum(c.total || 0)} contacts — ${c.activeRate || 0}% active, ${fmtNum(c.unsubscribed || 0)} unsubscribed, ${fmtNum(c.bounced || 0)} bounced.`;

  state.acData = d;
  // Populate the campaign status filter from the actual statuses present
  const counts = d.campaignStatusCounts || {};
  const order = ['Sent', 'Scheduled', 'Sending', 'Draft', 'Paused', 'Stopped', 'Disabled', 'Other'];
  const cur = $('email-camp-filter').value || 'all';
  $('email-camp-filter').innerHTML = `<option value="all">All statuses (${(d.campaigns || []).length})</option>`
    + order.filter(s => counts[s]).map(s => `<option value="${s}">${s} (${counts[s]})</option>`).join('');
  $('email-camp-filter').value = [...$('email-camp-filter').options].some(o => o.value === cur) ? cur : 'all';
  renderEmailCampaigns();
  renderEmailAutomations();
  renderEmailLists();
  lgSyncLists();
}
function renderEmailLists() {
  const d = state.acData; if (!d || !$('emailLists')) return;
  const q = ($('email-list-search').value || '').toLowerCase();
  let rows = d.lists || [];
  if (q) rows = rows.filter(l => (l.name || '').toLowerCase().includes(q));
  $('email-list-count').textContent = `${fmtNum(rows.length)} lists · ${fmtNum(d.listsActiveTotal || 0)} active`;
  $('emailLists').innerHTML = rows.map(l =>
    `<tr><td>${escHtml(l.name)}</td><td><span class="orders-count">${fmtNum(l.active)}</span></td><td class="muted">${fmtNum(l.total)}</td></tr>`).join('')
    || `<tr class="empty-row"><td colspan="3">${(d.lists || []).length ? 'No lists match' : 'No lists found'}</td></tr>`;
}
function renderEmailCampaigns() {
  const d = state.acData; if (!d) return;
  const f = $('email-camp-filter').value, q = ($('email-camp-search').value || '').toLowerCase();
  let rows = d.campaigns || [];
  if (f !== 'all') rows = rows.filter(c => c.status === f);
  if (q) rows = rows.filter(c => (c.name || '').toLowerCase().includes(q));
  $('email-camp-count').textContent = `${fmtNum(rows.length)} of ${fmtNum((d.campaigns || []).length)}`;
  const pct = v => v == null ? '<span class="muted">—</span>' : v + '%';
  $('emailCampaigns').innerHTML = rows.slice(0, 250).map(c => `<tr>
      <td>${escHtml(c.name)}</td>
      <td><span class="email-badge st-${(c.status || '').toLowerCase()}">${escHtml(c.status)}</span></td>
      <td>${escHtml(String(c.date || '').slice(0, 10))}</td>
      <td>${c.sent ? fmtNum(c.recipients) : '<span class="muted">—</span>'}</td>
      <td>${pct(c.openRate)}</td><td>${pct(c.clickRate)}</td><td>${pct(c.ctor)}</td><td>${pct(c.unsubRate)}</td><td>${pct(c.bounceRate)}</td>
    </tr>`).join('') || `<tr class="empty-row"><td colspan="9">No campaigns match</td></tr>`;
}
function renderEmailAutomations() {
  const d = state.acData; if (!d) return;
  const f = $('email-auto-filter').value, q = ($('email-auto-search').value || '').toLowerCase();
  let rows = (d.automations && d.automations.list) || [];
  if (f === 'active') rows = rows.filter(a => a.active);
  else if (f === 'inactive') rows = rows.filter(a => !a.active);
  if (q) rows = rows.filter(a => (a.name || '').toLowerCase().includes(q));
  $('email-auto-count').textContent = `${fmtNum(rows.length)} of ${fmtNum(((d.automations && d.automations.list) || []).length)}`;
  $('emailAutomations').innerHTML = rows.map(x =>
    `<tr><td>${escHtml(x.name)}</td><td>${x.active ? '<span class="roas-badge ok">active</span>' : '<span class="muted">off</span>'}</td><td>${fmtNum(x.entered)}</td><td>${fmtNum(x.inFlight)}</td><td>${x.completion}%</td></tr>`).join('')
    || `<tr class="empty-row"><td colspan="5">No automations match</td></tr>`;
}
['email-camp-filter', 'email-camp-search'].forEach(id => $(id).addEventListener('input', renderEmailCampaigns));
['email-auto-filter', 'email-auto-search'].forEach(id => $(id).addEventListener('input', renderEmailAutomations));
if ($('email-list-search')) $('email-list-search').addEventListener('input', renderEmailLists);
// List growth — pick a list → month-by-month gained/lost + active-over-time
function lgSyncLists() {
  const sel = $('lg-list'); if (!sel) return;
  const lists = (state.acData && state.acData.lists) || [], cur = sel.value;
  sel.innerHTML = '<option value="">Select a list…</option>' + lists.map(l => `<option value="${l.id}">${escHtml(l.name)} (${fmtNum(l.active)})</option>`).join('');
  if (lists.some(l => String(l.id) === cur)) sel.value = cur;
}
let lgSeq = 0;
async function loadListGrowth(listid) {
  if (!listid) { $('lg-body').hidden = true; $('lg-summary').hidden = true; $('lg-empty').hidden = false; $('lg-empty').textContent = 'Pick a list to see its month-to-month subscriber growth and loss.'; $('lg-status').textContent = ''; return; }
  const seq = ++lgSeq;
  $('lg-empty').hidden = false; $('lg-empty').textContent = 'Loading… (large lists can take up to a minute the first time)'; $('lg-body').hidden = true; $('lg-summary').hidden = true; $('lg-status').textContent = 'loading…';
  try {
    const d = await api('/api/ac/list-growth?listid=' + encodeURIComponent(listid));
    if (seq !== lgSeq) return;
    renderListGrowth(d);
  } catch (e) { if (seq !== lgSeq) return; $('lg-empty').hidden = false; $('lg-empty').textContent = 'Could not load: ' + escHtml(e.message); $('lg-status').textContent = ''; }
}
function renderListGrowth(d) {
  const s = d.series || [];
  $('lg-status').textContent = '';
  if (!s.length) { $('lg-empty').hidden = false; $('lg-empty').textContent = 'No membership history for this list yet.'; $('lg-body').hidden = true; $('lg-summary').hidden = true; return; }
  $('lg-empty').hidden = true; $('lg-body').hidden = false; $('lg-summary').hidden = false;
  const last = s[s.length - 1];
  const totalGained = s.reduce((a, x) => a + x.added, 0), totalLost = s.reduce((a, x) => a + x.removed, 0);
  $('lg-summary').innerHTML =
    `<span class="lg-stat"><b>${fmtNum(d.currentActive)}</b> active now</span>` +
    `<span class="lg-stat lg-up">+${fmtNum(last.added)} <small>last mo</small></span>` +
    `<span class="lg-stat lg-down">−${fmtNum(last.removed)} <small>last mo</small></span>` +
    `<span class="lg-stat"><b>${fmtNum(totalGained)}</b> gained · <b>${fmtNum(totalLost)}</b> lost <small>(${s.length} mo)</small></span>` +
    (d.capped ? `<span class="lg-stat lg-warn">⚠ ${fmtNum(d.totalMembers)} members — showing recent activity (older history approximate)</span>` : '');
  const labels = s.map(x => x.month);
  mkChart('lg-line', {
    type: 'line',
    data: { labels, datasets: [{ label: 'Active', data: s.map(x => x.active), borderColor: PALETTE[0], backgroundColor: 'rgba(37,99,235,0.10)', fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtNum(c.parsed.y) + ' active' } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 10 }, color: TICK } }, y: { grid: { color: GRID }, ticks: { font: { size: 10 }, color: TICK, precision: 0 }, beginAtZero: true } } },
  });
  mkChart('lg-bars', {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Gained', data: s.map(x => x.added), backgroundColor: '#16a34a', borderRadius: 3 },
      { label: 'Lost', data: s.map(x => -x.removed), backgroundColor: '#dc2626', borderRadius: 3 },
    ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, color: TICK } }, tooltip: { callbacks: { label: c => c.dataset.label + ': ' + fmtNum(Math.abs(c.parsed.y)) } } }, scales: { x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 }, color: TICK } }, y: { stacked: true, grid: { color: GRID }, ticks: { font: { size: 10 }, color: TICK, callback: v => fmtNum(Math.abs(v)) } } } },
  });
}
if ($('lg-list')) $('lg-list').addEventListener('change', e => loadListGrowth(e.target.value));
// Collapsible cards — click a card header (not its filters) to expand/collapse.
document.addEventListener('click', e => {
  if (e.target.closest('input, select, button, a, label')) return;
  const hdr = e.target.closest('.card-header');
  if (!hdr) return;
  const card = hdr.parentElement;
  if (card && card.classList.contains('collapsible')) card.classList.toggle('collapsed');
});
$('email-sync').addEventListener('click', async () => {
  const btn = $('email-sync'); btn.disabled = true; $('email-status').textContent = 'Syncing…';
  try {
    await fetch('/api/ac/sync', { method: 'POST' });
    const poll = setInterval(async () => {
      const s = await api('/api/ac/sync/status').catch(() => ({}));
      if (s.running === false) { clearInterval(poll); btn.disabled = false; loadEmail(); }
      else if (s.phase) $('email-status').textContent = `Syncing ${s.phase}…`;
    }, 2500);
  } catch { btn.disabled = false; $('email-status').textContent = 'Sync failed'; }
});

// ══ UTM & Links ═══════════════════════════════════════════════════
function buildUtm() {
  const base = $('utm-base').value.trim();
  const parts = [];
  for (const k of ['source', 'medium', 'campaign', 'term', 'content']) {
    const v = $('utm-' + k).value.trim();
    if (v) parts.push('utm_' + k + '=' + encodeURIComponent(v));
  }
  let url = base;
  if (base && parts.length) url += (base.includes('?') ? '&' : '?') + parts.join('&');
  $('utm-result').value = base ? url : '';
}
['utm-base', 'utm-source', 'utm-medium', 'utm-campaign', 'utm-term', 'utm-content'].forEach(id => $(id).addEventListener('input', buildUtm));
$('utm-copy').addEventListener('click', () => {
  const v = $('utm-result').value; if (!v) return;
  navigator.clipboard.writeText(v).then(() => { $('utm-copied').textContent = '✓ Copied!'; setTimeout(() => $('utm-copied').textContent = '', 2000); });
});
$('utm-clear').addEventListener('click', () => {
  ['utm-base', 'utm-source', 'utm-medium', 'utm-campaign', 'utm-term', 'utm-content', 'utm-result'].forEach(id => $(id).value = '');
});

function utmRangeParams() {
  return (state.utmStart && state.utmEnd) ? `start=${state.utmStart}&end=${state.utmEnd}` : '';
}
function utmOrderRange() {
  return (state.utmStart && state.utmEnd) ? [state.utmStart, state.utmEnd] : null;
}
// Prominent date-range picker (presets + custom from/to)
function setUtmRange(start, end, label, presetBtn) {
  state.utmStart = start || null; state.utmEnd = end || null;
  if ($('utm-start')) $('utm-start').value = start || '';
  if ($('utm-end')) $('utm-end').value = end || '';
  if ($('utm-dr-current')) $('utm-dr-current').textContent = label || 'All time';
  document.querySelectorAll('.utm-preset-btn').forEach(b => b.classList.toggle('active', b === presetBtn));
  loadUtm();
}
document.querySelectorAll('.utm-preset-btn').forEach(btn => btn.addEventListener('click', () => {
  const p = btn.dataset.utmp;
  if (p === 'all') return setUtmRange(null, null, 'All time', btn);
  const r = funnelPresetRange(p);
  if (r && r[0] && r[1]) setUtmRange(ymd(r[0]), ymd(r[1]), btn.textContent, btn);
}));
if ($('utm-apply')) $('utm-apply').addEventListener('click', () => {
  let s = $('utm-start').value, e = $('utm-end').value;
  if (s && e) { if (s > e) { const t = s; s = e; e = t; } setUtmRange(s, e, `${s} → ${e}`, null); }
});
if ($('cxp-campaign')) $('cxp-campaign').addEventListener('change', renderCxp);
// Orders attributed to a channel (from SamCart utm_parameters), within the UTM date range
function utmChannelOrders(channel) {
  const byDay = state.scData && state.scData.ordersByChannelByDay;
  if (!byDay) return { orders: 0, revenue: 0 };
  const rng = utmOrderRange();
  let o = 0, r = 0;
  const days = rng ? daysInRange(rng[0], rng[1]) : Object.keys(byDay);
  for (const day of days) { const e = byDay[day] && byDay[day][channel]; if (e) { o += e.orders; r += e.revenue; } }
  return { orders: o, revenue: r };
}
// Orders attributed to a full UTM combo (source|medium|campaign|content), within range
function utmRowOrders(row) {
  const byDay = state.scData && state.scData.ordersByUtmByDay;
  if (!byDay) return { orders: 0, revenue: 0 };
  const n = v => String(v || '').toLowerCase().trim() || '(none)';
  const key = `${n(row.source)}|${n(row.medium)}|${n(row.campaign)}|${n(row.content)}`;
  const rng = utmOrderRange();
  let o = 0, r = 0;
  const days = rng ? daysInRange(rng[0], rng[1]) : Object.keys(byDay);
  for (const day of days) { const e = byDay[day] && byDay[day][key]; if (e) { o += e.orders; r += e.revenue; } }
  return { orders: o, revenue: r };
}
async function loadUtm() {
  buildUtm();
  $('utm-status').textContent = 'Loading…';
  if (!state.scData) await loadSamCart().catch(() => {});   // need SamCart for channel orders
  try { renderUtm(await api('/api/analytics/utm' + (utmRangeParams() ? '?' + utmRangeParams() : ''))); $('utm-status').textContent = ''; }
  catch { $('utm-status').textContent = 'Error loading'; }
}
function renderUtm(d) {
  state.utmData = d;
  $('utm-kpis').innerHTML = [
    ['UTM Visits', fmtNum(d.total || 0), 'tagged page visits'],
    ['Unique Visitors', fmtNum(d.unique || 0), 'distinct visitors'],
    ['Channel Types', fmtNum(d.distinctChannels || 0), 'grouped by utm_content'],
    ['Campaigns', fmtNum(d.distinctCampaigns || 0), 'utm_campaign values'],
  ].map(([l, v, s]) => `<div class="stat-card"><div class="stat-label">${l}</div><div class="stat-value">${v}</div><div class="stat-sub">${s}</div></div>`).join('');

  const ch = (d.channels || []).slice(0, 14);
  mkChart('utmChannelChart', {
    type: 'bar',
    data: { labels: ch.map(c => c.channel), datasets: [{ data: ch.map(c => c.views), backgroundColor: '#2563eb', borderRadius: 5 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmtNum(c.raw) + ' views' } } },
      scales: { x: { grid: { color: GRID }, ticks: { font: { size: 9 }, color: TICK } }, y: { grid: { display: false }, ticks: { font: { size: 10 }, color: TICK } } } },
  });
  $('utmChannels').innerHTML = (d.channels || []).map(c =>
    `<tr><td><strong>${escHtml(c.channel)}</strong></td><td>${fmtNum(c.views)}</td><td>${fmtNum(c.unique)}</td><td>${c.checkoutViews ? fmtNum(c.checkoutViews) : '<span class="muted">—</span>'}</td><td>${c.orders ? '<span class="orders-count">' + fmtNum(c.orders) + '</span>' : '<span class="muted">—</span>'}</td></tr>`
  ).join('') || `<tr class="empty-row"><td colspan="5">No UTM traffic</td></tr>`;

  // Populate filter dropdowns
  const chans = [...new Set((d.rows || []).map(r => r.channel))].sort();
  const camps = [...new Set((d.rows || []).map(r => r.campaign).filter(c => c !== '(none)'))].sort();
  const cf = $('utm-channel-filter'), curCf = cf.value || 'all';
  cf.innerHTML = '<option value="all">All channels</option>' + chans.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  cf.value = chans.includes(curCf) ? curCf : 'all';
  const pf = $('utm-campaign-filter'), curPf = pf.value || 'all';
  pf.innerHTML = '<option value="all">All campaigns</option>' + camps.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  pf.value = camps.includes(curPf) ? curPf : 'all';

  // Channel × Product campaign selector — default to Reconnection Compass if present
  const cxp = $('cxp-campaign');
  if (cxp) {
    const curCxp = cxp.value;
    cxp.innerHTML = camps.length ? camps.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('') : '<option value="">(no campaigns)</option>';
    cxp.value = camps.includes(curCxp) ? curCxp
      : (camps.find(c => /reconnection_compass/i.test(c)) || camps[0] || '');
  }
  renderUtmRows();
  renderCxp();
}
function renderUtmRows() {
  const d = state.utmData; if (!d) return;
  const chf = $('utm-channel-filter').value, cpf = $('utm-campaign-filter').value, q = ($('utm-search').value || '').toLowerCase();
  let rows = d.rows || [];
  if (chf !== 'all') rows = rows.filter(r => r.channel === chf);
  if (cpf !== 'all') rows = rows.filter(r => r.campaign === cpf);
  if (q) rows = rows.filter(r => (r.campaign + ' ' + r.content + ' ' + r.source + ' ' + r.channel).toLowerCase().includes(q));
  $('utm-count').textContent = `${fmtNum(rows.length)} of ${fmtNum((d.rows || []).length)}`;
  $('utmRows').innerHTML = rows.slice(0, 300).map(r =>
    `<tr><td><strong>${escHtml(r.channel)}</strong></td><td>${escHtml(r.source)}</td><td>${escHtml(r.medium)}</td><td>${escHtml(r.campaign)}</td><td>${escHtml(r.content)}</td><td>${fmtNum(r.views)}</td><td>${fmtNum(r.unique)}</td><td>${r.checkoutViews ? fmtNum(r.checkoutViews) : '<span class="muted">—</span>'}</td><td>${r.orders ? '<span class="orders-count">' + fmtNum(r.orders) + '</span>' : '<span class="muted">—</span>'}</td><td>${escHtml(String(r.lastSeen || '').slice(0, 10))}</td></tr>`
  ).join('')
    || `<tr class="empty-row"><td colspan="10">No UTM traffic matches</td></tr>`;
}
['utm-channel-filter', 'utm-campaign-filter', 'utm-search'].forEach(id => $(id).addEventListener('input', renderUtmRows));

// Channel × Product breakdown for the selected campaign (views/unique are channel-level;
// checkout views/orders/revenue are per product). Orders come from SamCart utm_parameters.
function renderCxp() {
  const d = state.utmData, sc = state.scData;
  const camp = $('cxp-campaign') ? $('cxp-campaign').value : '';
  if (!d || !camp) { if ($('cxpRows')) $('cxpRows').innerHTML = '<tr class="empty-row"><td colspan="6">Select a campaign</td></tr>'; return; }

  // channel-level views/unique/checkout — true dedup from the server (campaignChannels)
  const chAgg = {};
  for (const cc of (d.campaignChannels || [])) {
    if (cc.campaign !== camp) continue;
    chAgg[cc.channel] = { views: cc.views, unique: cc.unique, checkout: cc.checkout };
  }
  // product-level checkout views from channelProducts
  const prodView = {};
  for (const cp of (d.channelProducts || [])) {
    if (cp.campaign !== camp) continue;
    (prodView[cp.channel] = prodView[cp.channel] || {})[cp.product] = { cv: cp.checkoutViews, cu: cp.checkoutUnique };
  }
  // real orders/revenue per channel×product from SamCart (order UTM), over the date range
  const prodOrd = sumCxpOrders(sc && sc.ordersByChannelProductByDay, camp);

  // estimated orders (time-matched, for UTM-less historical orders) — same shape
  const prodEst = sumCxpOrders(sc && sc.estOrdersByChannelProductByDay, camp);

  // Orders cell: real count (bold) + estimated count (muted "(N est)")
  const get = (m, ch, p, f) => (m[ch] && m[ch][p] && m[ch][p][f]) || 0;
  const ordersCell = (real, est) => {
    const parts = [];
    if (real) parts.push('<span class="orders-count">' + fmtNum(real) + '</span>');
    if (est) parts.push('<span class="muted cxp-est">(' + fmtNum(est) + ' est)</span>');
    return parts.length ? parts.join(' ') : '<span class="muted">—</span>';
  };

  const channels = [...new Set([...Object.keys(chAgg), ...Object.keys(prodView), ...Object.keys(prodOrd), ...Object.keys(prodEst)])].sort();
  let html = '';
  for (const ch of channels) {
    const prods = [...new Set([...Object.keys(prodView[ch] || {}), ...Object.keys(prodOrd[ch] || {}), ...Object.keys(prodEst[ch] || {})])];
    const chOrders = prods.reduce((s, p) => s + get(prodOrd, ch, p, 'orders'), 0);
    const chEst = prods.reduce((s, p) => s + get(prodEst, ch, p, 'orders'), 0);
    const chRev = prods.reduce((s, p) => s + get(prodOrd, ch, p, 'revenue') + get(prodEst, ch, p, 'revenue'), 0);
    const a = chAgg[ch] || { views: 0, unique: 0, checkout: 0 };
    html += `<tr class="cxp-channel"><td><strong>${escHtml(ch)}</strong></td><td>${fmtNum(a.views)}</td><td>${fmtNum(a.unique)}</td><td>${a.checkout ? fmtNum(a.checkout) : '<span class="muted">—</span>'}</td><td>${ordersCell(chOrders, chEst)}</td><td>${chRev ? fmtMoney(chRev) : '<span class="muted">—</span>'}</td></tr>`;
    prods.sort((x, y) => (get(prodOrd, ch, y, 'orders') + get(prodEst, ch, y, 'orders') + get(prodView, ch, y, 'cv')) - (get(prodOrd, ch, x, 'orders') + get(prodEst, ch, x, 'orders') + get(prodView, ch, x, 'cv')));
    for (const p of prods) {
      const cv = get(prodView, ch, p, 'cv');
      const rev = get(prodOrd, ch, p, 'revenue') + get(prodEst, ch, p, 'revenue');
      html += `<tr class="cxp-product"><td class="cxp-prod-name">↳ ${escHtml(p)}</td><td class="muted">—</td><td class="muted">—</td><td>${cv ? fmtNum(cv) : '<span class="muted">—</span>'}</td><td>${ordersCell(get(prodOrd, ch, p, 'orders'), get(prodEst, ch, p, 'orders'))}</td><td>${rev ? fmtMoney(rev) : '<span class="muted">—</span>'}</td></tr>`;
    }
  }
  $('cxpRows').innerHTML = html || `<tr class="empty-row"><td colspan="6">No data for this campaign in the selected dates</td></tr>`;
}
// Sum a SamCart by-day channel×product structure (real or estimate) over the UTM date
// range → { channel -> { product -> { orders, revenue } } } for the given campaign.
function sumCxpOrders(byDay, camp) {
  const out = {};
  if (!byDay) return out;
  const SEP = String.fromCharCode(1);
  const rng = utmOrderRange();
  const days = rng ? daysInRange(rng[0], rng[1]) : Object.keys(byDay);
  for (const day of days) {
    const e = byDay[day]; if (!e) continue;
    for (const key in e) {
      const parts = key.split(SEP); if (parts[0] !== camp) continue;
      const c = out[parts[1]] = out[parts[1]] || {};
      const p = c[parts[2]] = c[parts[2]] || { orders: 0, revenue: 0 };
      p.orders += e[key].orders; p.revenue += e[key].revenue;
    }
  }
  return out;
}

// ── Form Submissions ──────────────────────────────────────────────
const fxHookUrl = token => `${location.origin}/hook/${token}`;
const fxPost = async (path, body) => { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); if (!r.ok) throw new Error(await r.text()); return r.json(); };
const fxDel  = async (path) => { const r = await fetch(path, { method: 'DELETE' }); if (!r.ok) throw new Error(await r.text()); return r.json(); };

async function loadForms() {
  $('fx-status').textContent = 'Loading…';
  try {
    const [hooks, forms] = await Promise.all([api('/api/forms/webhooks'), api('/api/forms/list')]);
    state.fxForms = forms;
    renderFxWebhooks(hooks);
    renderFxForms(forms);
    faSyncForms();
    const sel = $('fx-form-filter'), cur = sel.value;
    sel.innerHTML = '<option value="">All forms</option>' + forms.map(f => `<option value="${escHtml(f.form_key)}">${escHtml(f.name)} (${f.count})</option>`).join('');
    sel.value = forms.some(f => f.form_key === cur) ? cur : '';
    await fxSearch();
    loadSourceSummary();
    $('fx-status').textContent = '';
  } catch (e) { $('fx-status').textContent = '⚠ Run forms-schema.sql in Supabase'; $('fx-webhooks').innerHTML = '<p class="th-hint" style="padding:6px 2px;">Once the form tables are created (one-time SQL), this page is fully self-service.</p>'; }
}
function renderFxWebhooks(hooks) {
  $('fx-webhooks').innerHTML = (hooks && hooks.length) ? hooks.map(h => `
    <div class="fx-hook">
      <div class="fx-hook-top"><strong>${escHtml(h.name)}</strong><span class="fx-hook-meta">${fmtNum(h.count)} received${h.last_fired_at ? ' · last ' + timeAgo(h.last_fired_at) : ' · never fired'}</span><button class="fx-hook-del" data-id="${h.id}" title="Delete webhook">✕</button></div>
      <div class="fx-hook-url"><input readonly value="${escHtml(fxHookUrl(h.token))}"><button class="fx-copy" data-url="${escHtml(fxHookUrl(h.token))}">Copy</button></div>
    </div>`).join('')
    : '<p class="th-hint" style="padding:6px 2px;">No webhooks yet. Click “+ Create webhook”, then paste the URL into your other software’s webhook/automation step.</p>';
}
function renderFxForms(forms) {
  $('fx-forms').innerHTML = (forms && forms.length) ? forms.map(f => `
    <tr><td><input class="fx-form-name" data-key="${escHtml(f.form_key)}" value="${escHtml(f.name)}" title="Rename this form"></td>
      <td><a href="#" class="fx-form-link" data-key="${escHtml(f.form_key)}"><span class="orders-count">${fmtNum(f.count)}</span></a></td>
      <td>${f.lastAt ? timeAgo(f.lastAt) : '—'}</td>
      <td class="fx-form-actions"><button class="fx-mini" data-fxcsv="${escHtml(f.form_key)}" title="Download this form as CSV">⬇ CSV</button><button class="fx-mini fx-del" data-fxdelform="${escHtml(f.form_key)}" title="Delete all submissions for this form">🗑</button></td></tr>`).join('')
    : '<tr class="empty-row"><td colspan="4">No forms yet</td></tr>';
}
async function fxSearch() {
  const search = $('fx-search').value.trim(), form = $('fx-form-filter').value;
  const qs = new URLSearchParams(); if (search) qs.set('search', search); if (form) qs.set('form', form);
  let subs = []; try { subs = await api('/api/forms/submissions?' + qs.toString()); } catch {}
  const fname = k => ((state.fxForms || []).find(f => f.form_key === k) || {}).name || k || '—';
  const srcTag = s => s && s !== 'Direct / Unknown' ? `<span class="fx-src-tag">${escHtml(s)}</span>` : '<span class="muted">—</span>';
  fxSelected.clear();
  $('fx-subs').innerHTML = (subs && subs.length) ? subs.map(s => `
    <tr class="fx-sub-row" data-id="${s.id}">
      <td class="fx-check-cell"><input type="checkbox" class="fx-check" data-id="${s.id}"></td>
      <td><strong>${escHtml(s.contact_name || '—')}</strong></td>
      <td>${escHtml(s.contact_email || '—')}</td>
      <td>${escHtml(fname(s.form_key))}</td>
      <td>${srcTag(s.source)}</td>
      <td>${s.created_at ? timeAgo(s.created_at) : ''}</td>
    </tr>`).join('')
    : `<tr class="empty-row"><td colspan="6">${(search || form) ? 'No matches' : 'No submissions yet — fire your webhook to test it'}</td></tr>`;
  fxUpdateBulk();
}
const fxSelected = new Set();
function fxUpdateBulk() {
  const btn = $('fx-bulk-del');
  if (btn) { btn.hidden = fxSelected.size === 0; btn.textContent = `🗑 Delete selected (${fxSelected.size})`; }
  const all = $('fx-select-all');
  if (all) { const boxes = $('fx-subs').querySelectorAll('.fx-check'); all.checked = boxes.length > 0 && [...boxes].every(b => b.checked); }
}
async function loadSourceSummary() {
  const el = $('fx-source-summary'); if (!el) return;
  const form = $('fx-form-filter').value;
  try { renderSourceSummary(await api('/api/forms/source-summary' + (form ? '?form=' + encodeURIComponent(form) : ''))); }
  catch { el.innerHTML = ''; }
}
function renderSourceSummary(d) {
  const el = $('fx-source-summary'); if (!el) return;
  const src = (d && d.sources) || [];
  if (!src.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<span class="fx-ss-label">Submissions by source</span>` + src.map((s, i) =>
    `<span class="fx-ss-pill${i === 0 ? ' top' : ''}">${escHtml(s.source)} <strong>${fmtNum(s.count)}</strong> <span class="fx-ss-pct">${s.pct}%</span></span>`).join('');
}
async function openSubmission(id) {
  try {
    const s = await api('/api/forms/submissions/' + id);
    $('fx-modal-title').textContent = s.contact_name || s.contact_email || 'Submission';
    const fields = Array.isArray(s.fields) ? s.fields : [];
    const qa = fields.length ? fields.map(f => `<div class="fx-qa"><div class="fx-q">${escHtml(f.q)}</div><div class="fx-a">${escHtml(f.a)}</div></div>`).join('') : '<p class="th-hint">No parsed fields — see raw payload below.</p>';
    $('fx-modal-body').innerHTML = `
      <div class="fx-meta">${s.contact_email ? '✉ ' + escHtml(s.contact_email) + ' · ' : ''}${s.created_at ? fmtET(s.created_at) : ''}</div>
      ${qa}
      <details class="fx-raw"><summary>Raw payload</summary><pre>${escHtml(JSON.stringify(s.payload, null, 2))}</pre></details>
      <div class="fx-modal-actions"><button class="fx-mini fx-del" data-fxdelsub="${s.id}">🗑 Delete this submission</button></div>`;
    $('fx-modal').hidden = false;
  } catch (e) { console.error('openSubmission failed:', e); }
}
const closeFxModal = () => { $('fx-modal').hidden = true; };
if ($('fx-new-webhook')) $('fx-new-webhook').addEventListener('click', async () => {
  const name = prompt('Name this webhook (e.g. "Reconnection quiz"):');
  if (name === null) return;
  try { await fxPost('/api/forms/webhooks', { name }); loadForms(); } catch (e) { alert('Could not create webhook: ' + e.message); }
});
if ($('fx-webhooks')) $('fx-webhooks').addEventListener('click', async e => {
  const cp = e.target.closest('.fx-copy');
  if (cp) { navigator.clipboard.writeText(cp.dataset.url); cp.textContent = 'Copied!'; setTimeout(() => cp.textContent = 'Copy', 1500); return; }
  const del = e.target.closest('.fx-hook-del');
  if (del && confirm('Delete this webhook? (Captured submissions are kept.)')) { try { await fxDel('/api/forms/webhooks/' + del.dataset.id); loadForms(); } catch {} }
});
const fxDownload = url => { const a = document.createElement('a'); a.href = url; document.body.appendChild(a); a.click(); a.remove(); };
if ($('fx-subs')) $('fx-subs').addEventListener('click', e => {
  if (e.target.closest('.fx-check-cell')) return;        // checkbox cell → don't open the submission
  const r = e.target.closest('.fx-sub-row'); if (r) openSubmission(r.dataset.id);
});
if ($('fx-subs')) $('fx-subs').addEventListener('change', e => {
  const cb = e.target.closest('.fx-check'); if (!cb) return;
  cb.checked ? fxSelected.add(cb.dataset.id) : fxSelected.delete(cb.dataset.id);
  fxUpdateBulk();
});
if ($('fx-select-all')) $('fx-select-all').addEventListener('change', e => {
  const on = e.target.checked;
  $('fx-subs').querySelectorAll('.fx-check').forEach(b => { b.checked = on; on ? fxSelected.add(b.dataset.id) : fxSelected.delete(b.dataset.id); });
  fxUpdateBulk();
});
if ($('fx-bulk-del')) $('fx-bulk-del').addEventListener('click', async () => {
  const n = fxSelected.size; if (!n) return;
  if (!confirm(`Delete ${n} selected submission${n === 1 ? '' : 's'}? This cannot be undone.`)) return;
  try { await fxPost('/api/forms/submissions/bulk-delete', { ids: [...fxSelected] }); fxSelected.clear(); fxSearch(); loadForms(); loadSourceSummary(); }
  catch (e) { alert('Delete failed: ' + e.message); }
});

// ── Sales Alerts / Notification Center (week-over-week sales drops) ────
const alertState = { basis: 'lastfull', dim: 'campaign', metric: 'all', threshold: 10 };
const AL_SEP = String.fromCharCode(1);                       // campaign∴channel∴product key separator
const AL_FLOOR = { revenue: 25, orders: 2, upsells: 2 };     // ignore tiny prior-period values (noise)
const AL_METRIC_LABEL = { revenue: 'Revenue', orders: 'Orders', upsells: 'Upsells' };
const alMoney = v => (typeof fmtMoney === 'function' ? fmtMoney(v) : '$' + Math.round(v || 0));
const alVal = (m, v) => m === 'revenue' ? alMoney(v) : fmtNum(Math.round(v || 0));
const alMd = s => { const d = new Date(s + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
const alRange = (from, to) => from === to ? alMd(from) : `${alMd(from)} – ${alMd(to)}`;

// Monday-start week windows (Eastern), for each comparison basis.
function alWindows(basis) {
  const today = nowET(), t = ymd(today);
  const mondayBack = (today.getDay() + 6) % 7;               // days since this week's Monday
  const thisMon = ymd(_addDays(t, -mondayBack));
  if (basis === 'day')  return { thisFrom: t, thisTo: t, lastFrom: ymd(_addDays(t, -7)), lastTo: ymd(_addDays(t, -7)) };
  if (basis === 'week') return { thisFrom: thisMon, thisTo: t, lastFrom: ymd(_addDays(thisMon, -7)), lastTo: ymd(_addDays(t, -7)) };
  // 'lastfull' — last complete Mon–Sun vs the week before it
  return { thisFrom: ymd(_addDays(thisMon, -7)), thisTo: ymd(_addDays(thisMon, -1)), lastFrom: ymd(_addDays(thisMon, -14)), lastTo: ymd(_addDays(thisMon, -8)) };
}
function alDays(from, to) { const out = []; let d = from, g = 0; while (d <= to && g++ < 800) { out.push(d); d = ymd(_addDays(d, 1)); } return out; }
function alSumChannel(byDay, from, to) {
  const out = {}; if (!byDay) return out;
  for (const day of alDays(from, to)) { const e = byDay[day]; if (!e) continue;
    for (const ch in e) { const o = out[ch] || (out[ch] = { orders: 0, revenue: 0 }); o.orders += e[ch].orders || 0; o.revenue += e[ch].revenue || 0; } }
  return out;
}
function alSumCampaignChannel(byDay, from, to) {
  const out = {}; if (!byDay) return out;
  for (const day of alDays(from, to)) { const e = byDay[day]; if (!e) continue;
    for (const key in e) { const p = key.split(AL_SEP), camp = p[0] || '(none)', ch = p[1] || '(untagged)', k = camp + AL_SEP + ch;
      const o = out[k] || (out[k] = { orders: 0, revenue: 0, campaign: camp, channel: ch }); o.orders += e[key].orders || 0; o.revenue += e[key].revenue || 0; } }
  return out;
}
function alDrop(metric, thisVal, lastVal, meta) {
  if ((lastVal || 0) < (AL_FLOOR[metric] || 1)) return null;        // prior period too small to be meaningful
  const dropPct = (lastVal - thisVal) / lastVal * 100;
  if (dropPct < alertState.threshold) return null;                  // not down enough (also excludes gains / flat)
  return { metric, thisVal, lastVal, dropPct, deltaVal: lastVal - thisVal,
    severity: dropPct >= 50 ? 'crit' : dropPct >= 25 ? 'high' : 'med', ...meta };
}
function alEmit(thisMap, lastMap, metric, field, labelFn) {
  const out = [], keys = new Set([...Object.keys(thisMap), ...Object.keys(lastMap)]);
  for (const k of keys) { const a = alDrop(metric, (thisMap[k] || {})[field] || 0, (lastMap[k] || {})[field] || 0, labelFn(k, thisMap[k] || lastMap[k])); if (a) out.push(a); }
  return out;
}
function computeAlerts() {
  const sc = state.scData;
  if (!sc || !sc.ordersByChannelByDay) return { alerts: [], w: null, ready: !!sc };
  const w = alWindows(alertState.basis);
  const metrics = alertState.metric === 'all' ? ['revenue', 'orders', 'upsells'] : [alertState.metric];
  const alerts = [];
  if (alertState.dim === 'channel') {
    const tC = alSumChannel(sc.ordersByChannelByDay, w.thisFrom, w.thisTo), lC = alSumChannel(sc.ordersByChannelByDay, w.lastFrom, w.lastTo);
    const tU = alSumChannel(sc.upsellByChannelByDay, w.thisFrom, w.thisTo), lU = alSumChannel(sc.upsellByChannelByDay, w.lastFrom, w.lastTo);
    const lbl = ch => ({ label: ch, channel: ch, campaign: '' });
    if (metrics.includes('revenue')) alerts.push(...alEmit(tC, lC, 'revenue', 'revenue', lbl));
    if (metrics.includes('orders'))  alerts.push(...alEmit(tC, lC, 'orders', 'orders', lbl));
    if (metrics.includes('upsells')) alerts.push(...alEmit(tU, lU, 'upsells', 'orders', lbl));
  } else {
    const tCC = alSumCampaignChannel(sc.ordersByChannelProductByDay, w.thisFrom, w.thisTo), lCC = alSumCampaignChannel(sc.ordersByChannelProductByDay, w.lastFrom, w.lastTo);
    const lbl = (k, e) => { const camp = (e && e.campaign) || k.split(AL_SEP)[0] || '(none)', ch = (e && e.channel) || k.split(AL_SEP)[1] || '(untagged)';
      return { label: (camp && camp !== '(none)') ? `${camp} · ${ch}` : ch, channel: ch, campaign: camp === '(none)' ? '' : camp }; };
    if (metrics.includes('revenue')) alerts.push(...alEmit(tCC, lCC, 'revenue', 'revenue', lbl));
    if (metrics.includes('orders'))  alerts.push(...alEmit(tCC, lCC, 'orders', 'orders', lbl));
    // upsells aren't tracked at campaign×channel granularity (channel-level only)
  }
  alerts.sort((a, b) => b.dropPct - a.dropPct);
  return { alerts, w, ready: true };
}
function renderAlerts() {
  const sc = state.scData;
  if ($('alerts-synced')) $('alerts-synced').textContent = (sc && sc.syncedAt) ? 'Data as of ' + timeAgo(sc.syncedAt) : '';
  const { alerts, w, ready } = computeAlerts();
  if (!ready) { $('alerts-list').innerHTML = '<div class="soc-empty">Loading SamCart data… if this persists, click “↻ Update”.</div>'; $('alerts-window').textContent = ''; $('alerts-summary').textContent = ''; return; }
  $('alerts-window').innerHTML = w ? `Comparing <strong>${alRange(w.thisFrom, w.thisTo)}</strong> vs <strong>${alRange(w.lastFrom, w.lastTo)}</strong>` : '';
  const revDrops = alerts.filter(a => a.metric === 'revenue'), lostRev = revDrops.reduce((s, a) => s + a.deltaVal, 0);
  $('alerts-summary').innerHTML = alerts.length
    ? `<span class="alerts-count">${alerts.length}</span> alert${alerts.length > 1 ? 's' : ''}${revDrops.length ? ` · ${revDrops.length} revenue drop${revDrops.length > 1 ? 's' : ''} totalling <strong>${alMoney(lostRev)}</strong> below the previous period` : ''}.`
    : '';
  if (!alerts.length) {
    const upHint = (alertState.dim === 'campaign' && alertState.metric === 'upsells');
    $('alerts-list').innerHTML = upHint
      ? '<div class="alerts-clear">Upsell drops are tracked <strong>By channel / post type</strong> — switch the breakdown selector to see them.</div>'
      : `<div class="alerts-clear">✓ No ${alertState.metric === 'all' ? '' : AL_METRIC_LABEL[alertState.metric].toLowerCase() + ' '}drops ≥ ${alertState.threshold}% — everything is holding or up vs the previous period.</div>`;
    return;
  }
  $('alerts-list').innerHTML = alerts.map(a => `
    <div class="alert-card alert-${a.severity}">
      <div class="alert-top"><span class="alert-badge">${AL_METRIC_LABEL[a.metric]} ↓ ${a.dropPct.toFixed(1)}%</span><span class="alert-title" title="${escHtml(a.label)}">${escHtml(a.label)}</span></div>
      <div class="alert-cmp">
        <div class="alert-col"><span class="alert-now">${alVal(a.metric, a.thisVal)}</span><span class="alert-range">${alRange(w.thisFrom, w.thisTo)}</span></div>
        <span class="alert-vs">↓ from</span>
        <div class="alert-col"><span class="alert-was">${alVal(a.metric, a.lastVal)}</span><span class="alert-range">${alRange(w.lastFrom, w.lastTo)}</span></div>
      </div>
      <div class="alert-detail">Down <strong>${alVal(a.metric, a.deltaVal)}</strong> (${a.dropPct.toFixed(1)}%) vs the previous ${alertState.basis === 'day' ? 'week’s day' : 'week'}.</div>
    </div>`).join('');
}
function updateAlertBadge() {
  const badge = $('alerts-badge'); if (!badge) return;
  if (!state.scData || !state.scData.ordersByChannelByDay) { badge.hidden = true; return; }
  const n = computeAlerts().alerts.length;
  badge.textContent = n > 99 ? '99+' : n; badge.hidden = n === 0;
}
async function loadAlerts() {
  if (!state.scData) { try { await loadSamCart(); } catch {} }
  renderAlerts(); updateAlertBadge();
}
['alerts-basis', 'alerts-dim', 'alerts-metric', 'alerts-threshold'].forEach(id => { const el = $(id); if (el) el.addEventListener('change', () => {
  alertState.basis = $('alerts-basis').value; alertState.dim = $('alerts-dim').value; alertState.metric = $('alerts-metric').value; alertState.threshold = +$('alerts-threshold').value;
  renderAlerts(); updateAlertBadge();
}); });
if ($('alerts-update')) $('alerts-update').addEventListener('click', async () => {
  const btn = $('alerts-update'), lbl = btn.textContent; btn.disabled = true; btn.textContent = 'Updating…';
  try { await loadSamCart(); } catch {}
  renderAlerts(); updateAlertBadge();
  btn.disabled = false; btn.textContent = lbl;
});

// ── Social Report (Facebook + Instagram via Apify) ────────────────────
const SOC_PLAT_COLOR = { Facebook: '#4267B2', Instagram: '#C13584' };
const socState = { view: 'cards', sort: 'recent', date: 'all', page: 1, calYM: null };
const SOC_PAGE = 24;
const socUrl = u => /^https?:\/\//i.test(u || '') ? u : '';   // only allow http(s) hrefs (block javascript:)
function socMetrics(p) {
  const v = p.views || 0, l = p.likes || 0, c = p.comments || 0, s = p.shares || 0, e = l + c + s;
  return { eng: e, engRate: v ? e / v * 100 : null, likeRate: v ? l / v * 100 : null, commentRate: v ? c / v * 100 : null, shareRate: v ? s / v * 100 : null, resonance: l ? (c + s) / l : null, virality: e ? s / e * 100 : null };
}
const socPct = n => n == null ? '—' : (Math.round(n * 10) / 10) + '%';
const socX = n => n == null ? '—' : (Math.round(n * 100) / 100) + '×';
const socDay = ts => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts)); } catch { return ''; } };
function socialDateParts(ts) {
  if (!ts) return { day: '', date: '', time: '' };
  const d = new Date(ts); if (isNaN(d)) return { day: '', date: '', time: '' };
  const tz = { timeZone: 'America/New_York' };
  return {
    day: d.toLocaleDateString('en-US', { ...tz, weekday: 'short' }),
    date: d.toLocaleDateString('en-US', { ...tz, month: 'short', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { ...tz, hour: 'numeric', minute: '2-digit' }),
  };
}
async function loadSocialData() {
  try {
    state.socialData = await api('/api/social/data');
    if ($('social-banner')) $('social-banner').hidden = true;
    renderSocial();
    return true;
  } catch (e) {
    if ($('social-banner')) { $('social-banner').hidden = false; $('social-banner').innerHTML = '⚠ Run <code>social-schema.sql</code> in Supabase once, then click “Refresh now”.'; }
    if ($('social-feed')) $('social-feed').innerHTML = '<div class="soc-empty">No data yet.</div>';
    if ($('social-cards')) $('social-cards').innerHTML = '';
    return false;
  }
}
async function loadSocial() {
  await loadSocialData();
  try {
    const s = await api('/api/social/sync/status');
    if (s.running) startSocialPolling();            // a scrape is already running (e.g. the 8am job) → show it live
    else { hideSocialProgress(); if ($('social-synced')) $('social-synced').textContent = (state.socialData && state.socialData.synced) ? 'Updated ' + timeAgo(state.socialData.synced) : 'Not synced yet'; }
  } catch {}
}
function showSocialProgress(s) {
  const el = $('social-progress'); if (!el) return;
  el.hidden = false;
  const done = s.scrapersDone || 0, total = s.scrapersTotal || 4, found = s.found || 0;
  el.innerHTML = `<span class="soc-spinner"></span><div class="soc-prog-text"><strong>Scraping…</strong> ${escHtml(s.phase || '')} · ${fmtNum(found)} posts so far</div><div class="soc-prog-bar"><span style="width:${Math.round(done / total * 100)}%"></span></div>`;
}
function hideSocialProgress() { const el = $('social-progress'); if (el) el.hidden = true; }
let _socPoll = null;
function startSocialPolling() {
  if (_socPoll) return;
  const btn = $('social-sync'); if (btn) { btn.disabled = true; btn.textContent = 'Scraping…'; }
  showSocialProgress({ phase: 'Starting…', scrapersDone: 0, scrapersTotal: 4, found: 0 });
  _socPoll = setInterval(async () => {
    let s = { running: false };
    try { s = await api('/api/social/sync/status'); } catch {}
    showSocialProgress(s);
    await loadSocialData();                          // real-time: posts appear as each scraper upserts
    if (!s.running) stopSocialPolling(s);
  }, 3000);
  setTimeout(() => stopSocialPolling({ running: false, finishedAt: 1 }), 300000);   // safety stop
}
function stopSocialPolling(s) {
  if (_socPoll) { clearInterval(_socPoll); _socPoll = null; }
  hideSocialProgress();
  const btn = $('social-sync'); if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh now'; }
  if (s && s.error && $('social-banner')) { $('social-banner').hidden = false; $('social-banner').innerHTML = '⚠ Scrape error: ' + escHtml(s.error); }
  loadSocialData();
  if ($('social-synced') && state.socialData) $('social-synced').textContent = state.socialData.synced ? 'Updated ' + timeAgo(state.socialData.synced) : 'Updated just now';
}
function runSocialSync() {
  fetch('/api/social/sync', { method: 'POST' }).catch(() => {});
  setTimeout(startSocialPolling, 600);
}
function socialFiltered() {
  const d = state.socialData; if (!d) return [];
  const now = nowET();
  let from = null, to = null;
  if (socState.date === 'thismonth') { from = ymd(new Date(now.getFullYear(), now.getMonth(), 1)); to = ymd(now); }
  else if (socState.date === 'lastmonth') { from = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)); to = ymd(new Date(now.getFullYear(), now.getMonth(), 0)); }
  else if (socState.date === '30') { from = ymd(_addDays(ymd(now), -29)); to = ymd(now); }
  else if (socState.date === '90') { from = ymd(_addDays(ymd(now), -89)); to = ymd(now); }
  const plat = $('social-plat-filter').value, type = $('social-type-filter').value, q = ($('social-search').value || '').toLowerCase();
  let rows = (d.posts || []).filter(p => {
    if (plat && p.platform !== plat) return false;
    if (type && p.content_type !== type) return false;
    if (q && !((p.caption || '').toLowerCase().includes(q) || (p.hook_topic || '').toLowerCase().includes(q) || (p.offer || '').toLowerCase().includes(q))) return false;
    if (from || to) { const dd = socDay(p.posted_at); if (!dd || (from && dd < from) || (to && dd > to)) return false; }   // undated posts excluded from a range
    return true;
  });
  const sk = { views: 'views', likes: 'likes', comments: 'comments', shares: 'shares' }[socState.sort];
  if (sk) rows.sort((a, b) => (b[sk] || 0) - (a[sk] || 0));
  else if (socState.sort === 'engagement') rows.sort((a, b) => socMetrics(b).eng - socMetrics(a).eng);
  else rows.sort((a, b) => String(b.posted_at).localeCompare(String(a.posted_at)));
  return rows;
}
function renderSocial() {
  if (!state.socialData) return;
  const rows = socialFiltered();
  const sum = f => rows.reduce((s, p) => s + (p[f] || 0), 0);
  const v = sum('views'), l = sum('likes'), c = sum('comments'), s = sum('shares');
  // avg engagement rate over view-bearing posts only (so 0-view image posts don't inflate it)
  const vr = rows.filter(p => (p.views || 0) > 0);
  const vrV = vr.reduce((a, p) => a + (p.views || 0), 0), vrE = vr.reduce((a, p) => a + (p.likes || 0) + (p.comments || 0) + (p.shares || 0), 0);
  $('social-cards').innerHTML = [['Posts', fmtNum(rows.length)], ['Views', fmtNum(v)], ['Likes', fmtNum(l)], ['Comments', fmtNum(c)], ['Shares', fmtNum(s)], ['Avg eng. rate', socPct(vrV ? vrE / vrV * 100 : null)]]
    .map(([lab, val]) => `<div class="rf-card"><div class="rf-card-label">${lab}</div><div class="rf-card-val">${val}</div></div>`).join('');
  const byPlat = {}; for (const p of rows) { (byPlat[p.platform] = byPlat[p.platform] || { platform: p.platform, views: 0 }).views += p.views || 0; }
  const bp = Object.values(byPlat);
  mkChart('social-platform-chart', {
    type: 'doughnut',
    data: { labels: bp.map(p => p.platform), datasets: [{ data: bp.map(p => p.views), backgroundColor: bp.map(p => SOC_PLAT_COLOR[p.platform] || '#94a3b8'), borderWidth: 0, hoverOffset: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom', labels: { color: TICK, font: { size: 11 } } }, tooltip: { callbacks: { label: cc => ` ${cc.label}: ${fmtNum(cc.parsed)} views` } } } },
  });
  const topN = rows.slice().sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 8);
  mkChart('social-top-chart', {
    type: 'bar',
    data: { labels: topN.map(p => faTrunc((p.hook_topic || p.caption || p.content_type || '—').replace(/\n/g, ' '), 24)), datasets: [{ data: topN.map(p => p.views), backgroundColor: '#4267B2', borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: cc => ' ' + fmtNum(cc.parsed.x) + ' views' } } }, scales: { x: { grid: { color: GRID }, ticks: { color: TICK, font: { size: 10 }, callback: x => x >= 1000 ? (x / 1000) + 'k' : x }, beginAtZero: true }, y: { grid: { display: false }, ticks: { color: TICK, font: { size: 10 } } } } },
  });
  if (socState.view === 'table') renderSocialTable(rows);
  else if (socState.view === 'calendar') renderSocialCalendar(rows);
  else renderSocialCards(rows);
  $('social-feed').hidden = socState.view !== 'cards';
  $('social-table-wrap').hidden = socState.view !== 'table';
  $('social-calendar').hidden = socState.view !== 'calendar';
}
const socEdit = (id, f, val, ph) => `<input class="soc-edit" data-post="${escHtml(id)}" data-field="${f}" value="${escHtml(val || '')}" placeholder="${escHtml(ph || '')}">`;
function renderSocialCards(rows) {
  const shown = rows.slice(0, socState.page * SOC_PAGE);
  $('social-feed').innerHTML = shown.length ? shown.map(p => {
    const dt = socialDateParts(p.posted_at), plat = String(p.platform).toLowerCase(), m = socMetrics(p), cap = (p.caption || '').replace(/\n/g, ' ');
    return `<div class="soc-card">
      <div class="soc-card-media">${p.thumbnail ? `<img src="${escHtml(p.thumbnail)}" alt="" loading="lazy" onerror="this.remove()">` : `<div class="soc-noimg soc-bg-${plat}">${escHtml((p.platform || '?')[0])}</div>`}
        <span class="soc-plat soc-${plat}">${escHtml(p.platform)} · ${escHtml(p.content_type)}</span>
        ${socUrl(p.url) ? `<a href="${escHtml(socUrl(p.url))}" target="_blank" rel="noopener" class="soc-card-open" title="Open post">↗</a>` : ''}</div>
      <div class="soc-card-body">
        <div class="soc-card-date">${dt.date} · ${dt.time}${p.last_updated ? ` <span class="soc-upd">· upd ${escHtml(timeAgo(p.last_updated))}</span>` : ''}</div>
        <div class="soc-card-cap" title="${escHtml(cap)}">${escHtml(cap || '(no caption)')}</div>
        ${cap.length > 85 ? '<button class="soc-cap-toggle" type="button">more</button>' : ''}
        <div class="soc-card-metrics"><span title="Views">👁 ${fmtNum(p.views)}</span><span title="Likes">❤️ ${fmtNum(p.likes)}</span><span title="Comments">💬 ${fmtNum(p.comments)}</span><span title="Shares">🔁 ${fmtNum(p.shares)}</span></div>
        <div class="soc-card-derived"><span title="Engagement rate = (likes+comments+shares) ÷ views">ER ${socPct(m.engRate)}</span><span title="Resonance = (comments+shares) ÷ likes — deep engagement vs passive likes">Res ${socX(m.resonance)}</span><span title="Virality = shares ÷ total engagement">Vir ${socPct(m.virality)}</span></div>
        <div class="soc-card-fields">
          <label class="soc-f-wide"><span>Hook / Topic</span>${socEdit(p.post_id, 'hook_topic', p.hook_topic, 'add a hook…')}</label>
          <label><span>Offer</span>${socEdit(p.post_id, 'offer', p.offer, '—')}</label>
          <label class="soc-f-num"><span>Post #</span>${socEdit(p.post_id, 'post_num', p.post_num, '#')}</label>
          <label class="soc-f-wide"><span>Notes</span>${socEdit(p.post_id, 'notes', p.notes, 'notes…')}</label>
        </div>
      </div>
    </div>`;
  }).join('') : '<div class="soc-empty">No posts match — adjust filters or click “↻ Refresh now”.</div>';
  $('social-loadmore').hidden = shown.length >= rows.length;
}
function renderSocialTable(rows) {
  const shown = rows.slice(0, socState.page * SOC_PAGE);
  $('social-thead').innerHTML = `<tr><th>Date</th><th>Plat</th><th>Type</th><th>Hook / caption</th><th class="soc-mh">Views</th><th class="soc-mh">Likes</th><th class="soc-mh">Cmt</th><th class="soc-mh">Shr</th><th class="soc-mh" title="Engagement rate = engagement ÷ views">ER%</th><th class="soc-mh" title="Comments ÷ views">Cmt%</th><th class="soc-mh" title="Shares ÷ views">Shr%</th><th class="soc-mh" title="(comments+shares) ÷ likes">Reson.</th><th class="soc-mh" title="Shares ÷ engagement">Viral.</th><th></th></tr>`;
  $('social-tbody').innerHTML = shown.length ? shown.map(p => {
    const dt = socialDateParts(p.posted_at), m = socMetrics(p), plat = String(p.platform).toLowerCase();
    const label = p.hook_topic || (p.caption || '').replace(/\n/g, ' ').slice(0, 60) || '—';
    return `<tr>
      <td class="soc-nowrap">${dt.date}</td><td><span class="soc-plat soc-${plat}">${escHtml((p.platform || '?')[0])}</span></td><td>${escHtml(p.content_type)}</td>
      <td class="soc-tcap" title="${escHtml(p.caption || '')}">${escHtml(label)}</td>
      <td class="soc-metric">${fmtNum(p.views)}</td><td class="soc-metric">${fmtNum(p.likes)}</td><td class="soc-metric">${fmtNum(p.comments)}</td><td class="soc-metric">${fmtNum(p.shares)}</td>
      <td class="soc-metric">${socPct(m.engRate)}</td><td class="soc-metric">${socPct(m.commentRate)}</td><td class="soc-metric">${socPct(m.shareRate)}</td>
      <td class="soc-metric">${socX(m.resonance)}</td><td class="soc-metric">${socPct(m.virality)}</td>
      <td>${socUrl(p.url) ? `<a href="${escHtml(socUrl(p.url))}" target="_blank" rel="noopener" class="soc-link">↗</a>` : '—'}</td>
    </tr>`;
  }).join('') : '<tr class="empty-row"><td colspan="14">No posts match…</td></tr>';
  $('social-loadmore').hidden = shown.length >= rows.length;
}
function renderSocialCalendar(rows) {
  const now = nowET();
  // Month to display: explicit (from ‹ › nav) → selected month → most-recent month that has posts → current month.
  let ym = socState.calYM;
  if (!ym) {
    if (socState.date === 'lastmonth') { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
    else if (socState.date === 'thismonth') ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    else { const months = [...new Set(rows.map(p => socDay(p.posted_at).slice(0, 7)).filter(Boolean))].sort(); ym = months.length ? months[months.length - 1] : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; }
  }
  socState.calYM = ym;   // remember the shown month so the ‹ › buttons can shift from it
  const my = +ym.slice(0, 4), mm = +ym.slice(5, 7) - 1, target = ym;
  const byDay = {};
  for (const p of rows) { const dd = socDay(p.posted_at); if (dd.slice(0, 7) === target) (byDay[+dd.slice(8, 10)] = byDay[+dd.slice(8, 10)] || []).push(p); }
  const first = new Date(my, mm, 1).getDay(), daysIn = new Date(my, mm + 1, 0).getDate();
  const monthName = new Date(my, mm, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  let cells = '';
  for (let i = 0; i < first; i++) cells += '<div class="soc-cal-cell empty"></div>';
  for (let d = 1; d <= daysIn; d++) {
    const posts = byDay[d] || [];
    cells += `<div class="soc-cal-cell"><div class="soc-cal-day">${d}</div>${posts.map(p => `<a class="soc-cal-chip soc-bg-${String(p.platform).toLowerCase()}" href="${escHtml(socUrl(p.url) || '#')}" target="_blank" rel="noopener" title="${escHtml((p.hook_topic || p.caption || '').replace(/\n/g, ' ').slice(0, 90))} · ${fmtNum(p.views)} views · ${fmtNum(p.likes)} likes">${p.content_type === 'Reel' ? '▶ ' : ''}${fmtNum(p.views)}</a>`).join('')}</div>`;
  }
  $('social-calendar').innerHTML = `<div class="soc-cal-head"><button class="soc-cal-nav" data-cal="-1" type="button">‹</button> <strong>${monthName}</strong> <button class="soc-cal-nav" data-cal="1" type="button">›</button> <span class="th-hint">— click a chip to open the post</span></div>
    <div class="soc-cal-grid"><div class="soc-cal-dow">Sun</div><div class="soc-cal-dow">Mon</div><div class="soc-cal-dow">Tue</div><div class="soc-cal-dow">Wed</div><div class="soc-cal-dow">Thu</div><div class="soc-cal-dow">Fri</div><div class="soc-cal-dow">Sat</div>${cells}</div>`;
  $('social-loadmore').hidden = true;
}
document.querySelectorAll('#social-viewtoggle .soc-vbtn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#social-viewtoggle .soc-vbtn').forEach(x => x.classList.toggle('active', x === b));
  socState.view = b.dataset.view; socState.page = 1; socState.calYM = null; renderSocial();
}));
if ($('social-date')) $('social-date').addEventListener('change', e => { socState.date = e.target.value; socState.page = 1; socState.calYM = null; renderSocial(); });
if ($('social-sort')) $('social-sort').addEventListener('change', e => { socState.sort = e.target.value; socState.page = 1; renderSocial(); });
['social-plat-filter', 'social-type-filter', 'social-search'].forEach(id => { const el = $(id); if (el) el.addEventListener('input', () => { socState.page = 1; renderSocial(); }); });
if ($('social-calendar')) $('social-calendar').addEventListener('click', e => {
  const b = e.target.closest('.soc-cal-nav'); if (!b || !socState.calYM) return;
  const d = new Date(+socState.calYM.slice(0, 4), +socState.calYM.slice(5, 7) - 1 + (+b.dataset.cal), 1);
  socState.calYM = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  renderSocialCalendar(socialFiltered());
});
if ($('social-loadmore-btn')) $('social-loadmore-btn').addEventListener('click', () => { socState.page++; renderSocial(); });
if ($('social-feed')) {
  $('social-feed').addEventListener('change', async e => {
    const inp = e.target.closest('.soc-edit'); if (!inp) return;
    try {
      await fxPost('/api/social/field', { post_id: inp.dataset.post, field: inp.dataset.field, value: inp.value });
      const p = (state.socialData.posts || []).find(x => x.post_id === inp.dataset.post); if (p) p[inp.dataset.field] = inp.value;
      inp.classList.add('soc-saved'); setTimeout(() => inp.classList.remove('soc-saved'), 700);
    } catch { alert('Could not save'); }
  });
  $('social-feed').addEventListener('click', e => {
    const t = e.target.closest('.soc-cap-toggle'); if (!t) return;
    const cap = t.previousElementSibling;
    if (cap && cap.classList.contains('soc-card-cap')) { const ex = cap.classList.toggle('expanded'); t.textContent = ex ? 'less' : 'more'; }
  });
}
if ($('social-sync')) $('social-sync').addEventListener('click', runSocialSync);
if ($('social-export')) $('social-export').addEventListener('click', () => {
  const rows = socialFiltered(); if (!rows.length) return;
  const esc = val => { let s = String(val == null ? '' : val); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['Date', 'Time', 'Platform', 'Type', 'Post#', 'Hook/Topic', 'Offer', 'Views', 'Likes', 'Comments', 'Shares', 'EngRate%', 'Comment%', 'Share%', 'Resonance', 'Virality%', 'Link', 'Notes', 'Caption'];
  const lines = [head.join(',')];
  for (const p of rows) { const dt = socialDateParts(p.posted_at), m = socMetrics(p); lines.push([dt.date, dt.time, p.platform, p.content_type, p.post_num, p.hook_topic, p.offer, p.views, p.likes, p.comments, p.shares, m.engRate == null ? '' : m.engRate.toFixed(1), m.commentRate == null ? '' : m.commentRate.toFixed(2), m.shareRate == null ? '' : m.shareRate.toFixed(2), m.resonance == null ? '' : m.resonance.toFixed(2), m.virality == null ? '' : m.virality.toFixed(1), p.url, p.notes, (p.caption || '').replace(/\n/g, ' ')].map(esc).join(',')); }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = 'social-report.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
if ($('fx-export')) $('fx-export').addEventListener('click', () => {
  const qs = new URLSearchParams();
  const search = $('fx-search').value.trim(), form = $('fx-form-filter').value;
  if (search) qs.set('search', search); if (form) qs.set('form', form);
  fxDownload('/api/forms/export?' + qs.toString());
});
if ($('fx-modal-body')) $('fx-modal-body').addEventListener('click', async e => {
  const d = e.target.closest('[data-fxdelsub]');
  if (d && confirm('Delete this submission permanently?')) { try { await fxDel('/api/forms/submissions/' + d.dataset.fxdelsub); closeFxModal(); fxSearch(); loadForms(); } catch (err) { alert('Delete failed: ' + err.message); } }
});
if ($('fx-forms')) {
  $('fx-forms').addEventListener('click', async e => {
    const csv = e.target.closest('[data-fxcsv]'); if (csv) { fxDownload('/api/forms/export?form=' + encodeURIComponent(csv.dataset.fxcsv)); return; }
    const del = e.target.closest('[data-fxdelform]');
    if (del) { if (confirm('Delete ALL submissions for this form? This cannot be undone.')) { try { await fxDel('/api/forms/form/' + encodeURIComponent(del.dataset.fxdelform)); loadForms(); } catch (err) { alert('Delete failed: ' + err.message); } } return; }
    const l = e.target.closest('.fx-form-link'); if (l) { e.preventDefault(); $('fx-form-filter').value = l.dataset.key; fxSearch(); document.getElementById('fx-subs').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  });
  $('fx-forms').addEventListener('change', async e => { const n = e.target.closest('.fx-form-name'); if (n) { try { await fxPost('/api/forms/rename', { form_key: n.dataset.key, name: n.value }); (state.fxForms || []).forEach(f => { if (f.form_key === n.dataset.key) f.name = n.value; }); fxSearch(); } catch {} } });
}
let _fxT; if ($('fx-search')) $('fx-search').addEventListener('input', () => { clearTimeout(_fxT); _fxT = setTimeout(fxSearch, 300); });
if ($('fx-form-filter')) $('fx-form-filter').addEventListener('change', () => { fxSearch(); loadSourceSummary(); });
if ($('fx-modal-x')) $('fx-modal-x').addEventListener('click', closeFxModal);
if ($('fx-modal-close')) $('fx-modal-close').addEventListener('click', closeFxModal);
// Sub-navigation: Submissions ⇄ Data Analysis ⇄ Webhooks
document.querySelectorAll('#tab-forms .fx-subtab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#tab-forms .fx-subtab').forEach(x => x.classList.toggle('active', x === b));
  const v = b.dataset.fxview;
  document.querySelectorAll('#tab-forms .fx-view').forEach(view => { view.hidden = view.id !== 'fxview-' + v; });
  if (v === 'analysis') faSyncForms();
}));

// ── Data Analysis: form → column → answer breakdown ───────────────────
const FA_COLORS = ['#2563eb','#1e3a8a','#60a5fa','#1d4ed8','#93c5fd','#3b82f6','#1e40af','#38bdf8','#172554','#0ea5e9','#7dd3fc','#0369a1'];
let faBreakdown = null;   // last rendered breakdown (for CSV)
let faSeq = 0;            // request token — discard stale responses when switching form/column quickly

function faSyncForms() {
  const sel = $('fa-form'); if (!sel) return;
  const forms = state.fxForms || [], cur = sel.value;
  sel.innerHTML = '<option value="">Select a form…</option>' + forms.map(f => `<option value="${escHtml(f.form_key)}">${escHtml(f.name)} (${f.count})</option>`).join('');
  if (forms.some(f => f.form_key === cur)) sel.value = cur;
}
function faShowEmpty(msg) { if ($('fa-empty')) { $('fa-empty').textContent = msg; $('fa-empty').hidden = false; } if ($('fa-body')) $('fa-body').hidden = true; if ($('fa-export')) $('fa-export').hidden = true; }
function faClearCharts() { ['fa-donut','fa-bar'].forEach(id => { if (reportCharts[id]) { reportCharts[id].destroy(); delete reportCharts[id]; } }); if ($('fa-table')) $('fa-table').innerHTML = ''; faBreakdown = null; }
const faTrunc = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

async function faLoadColumns() {
  const form = $('fa-form').value, colSel = $('fa-column');
  faClearCharts(); $('fa-summary').textContent = '';
  if (!form) { colSel.innerHTML = '<option value="">Select a form first…</option>'; colSel.disabled = true; faShowEmpty('Select a form, then a question, to see the breakdown.'); return; }
  const my = ++faSeq;
  colSel.disabled = true; colSel.innerHTML = '<option value="">Loading…</option>';
  try {
    const d = await api('/api/forms/columns?form=' + encodeURIComponent(form));
    if (my !== faSeq) return;
    if (!d.columns || !d.columns.length) { colSel.innerHTML = '<option value="">No questions found</option>'; faShowEmpty('This form has no answer fields to analyse yet.'); return; }
    colSel.innerHTML = '<option value="">Select a question…</option>' + d.columns.map(c => `<option value="${escHtml(c.q)}">${escHtml(faTrunc(c.q, 60))} (${c.count})</option>`).join('');
    colSel.disabled = false;
    faShowEmpty('Now pick a question above to see how its answers break down.');
  } catch (e) { if (my !== faSeq) return; colSel.innerHTML = '<option value="">Error</option>'; faShowEmpty('Could not load questions: ' + e.message); }
}
async function faLoadBreakdown() {
  const form = $('fa-form').value, column = $('fa-column').value;
  faClearCharts();
  if (!form || !column) { faShowEmpty('Pick a question to see the breakdown.'); return; }
  const my = ++faSeq;
  faShowEmpty('Loading…'); $('fa-summary').textContent = '';
  try {
    const d = await api('/api/forms/breakdown?form=' + encodeURIComponent(form) + '&column=' + encodeURIComponent(column));
    if (my !== faSeq) return;
    renderFaBreakdown(d);
  } catch (e) { if (my !== faSeq) return; $('fa-summary').textContent = ''; faShowEmpty('Could not load breakdown: ' + e.message); }
}
function renderFaBreakdown(d) {
  faBreakdown = d;
  const values = d.values || [];
  if (!values.length) { $('fa-summary').textContent = ''; faShowEmpty('No answers recorded for this question yet.'); return; }
  $('fa-empty').hidden = true; $('fa-body').hidden = false; $('fa-export').hidden = false;
  $('fa-summary').innerHTML = `<strong>${escHtml(d.column)}</strong> — ${fmtNum(d.answered)} ${d.answered === 1 ? 'person' : 'people'} answered · ${fmtNum(d.distinct)} distinct ${d.distinct === 1 ? 'answer' : 'answers'}`;

  // top 10 + Other for the charts (table shows everything)
  const N = 10; let chartVals = values;
  if (values.length > N) {
    const rest = values.slice(N), otherCount = rest.reduce((s, v) => s + v.count, 0);
    chartVals = [...values.slice(0, N), { value: `Other (${rest.length})`, count: otherCount, pct: d.answered ? Math.round(otherCount / d.answered * 1000) / 10 : 0 }];
  }
  const labels = chartVals.map(v => faTrunc(v.value, 28));
  const counts = chartVals.map(v => v.count);
  const colors = chartVals.map((_, i) => PALETTE[i % PALETTE.length]);

  mkChart('fa-donut', {
    type: 'doughnut',
    data: { labels, datasets: [{ data: counts, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10, font: { size: 11 }, color: TICK } }, tooltip: { callbacks: { label: c => ` ${c.label}: ${fmtNum(c.parsed)} (${chartVals[c.dataIndex].pct}%)` } } } },
    plugins: [faDonutCenter(fmtNum(d.answered), d.answered === 1 ? 'person' : 'people')],
  });
  mkChart('fa-bar', {
    type: 'bar',
    data: { labels, datasets: [{ data: counts, backgroundColor: colors, borderRadius: 4, borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmtNum(c.parsed.x)} (${chartVals[c.dataIndex].pct}%)` } } }, scales: { x: { grid: { color: GRID }, ticks: { font: { size: 10 }, color: TICK, precision: 0 }, beginAtZero: true }, y: { grid: { display: false }, ticks: { font: { size: 11 }, color: TICK } } } },
  });
  const TBL = 100, tblRows = values.slice(0, TBL);
  $('fa-table').innerHTML = tblRows.map((v, i) => `
    <tr>
      <td><span class="fa-swatch" style="background:${PALETTE[i % PALETTE.length]}"></span>${escHtml(v.value)}</td>
      <td class="fa-num">${fmtNum(v.count)}</td>
      <td class="fa-num">${v.pct}%</td>
      <td class="fa-barcell"><span class="fa-barfill" style="width:${Math.min(100, v.pct)}%;background:${PALETTE[i % PALETTE.length]}"></span></td>
    </tr>`).join('') + (values.length > TBL ? `<tr><td colspan="4" class="th-hint">…and ${fmtNum(values.length - TBL)} more distinct answers — use ⬇ CSV for the full list.</td></tr>` : '');
}
function faDonutCenter(text, sub) {
  return { id: 'faDonutCenter', afterDraw(chart) {
    const a = chart.chartArea; if (!a) return; const ctx = chart.ctx;
    const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2;
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = (getComputedStyle(document.body).getPropertyValue('--text') || '#1a1a1a').trim();
    ctx.font = '700 20px Inter, system-ui, sans-serif'; ctx.fillText(text, x, y - 7);
    ctx.font = '500 11px Inter, system-ui, sans-serif'; ctx.fillStyle = TICK; ctx.fillText(sub, x, y + 12);
    ctx.restore();
  } };
}
if ($('fa-form')) $('fa-form').addEventListener('change', faLoadColumns);
if ($('fa-column')) $('fa-column').addEventListener('change', faLoadBreakdown);
if ($('fa-export')) $('fa-export').addEventListener('click', () => {
  if (!faBreakdown) return;
  const esc = v => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [['Answer', 'People', 'Percent'].join(','), ...faBreakdown.values.map(v => [esc(v.value), v.count, v.pct + '%'].join(','))];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = (faBreakdown.column || 'breakdown').replace(/[^a-z0-9]+/gi, '-').slice(0, 50) + '.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ── Refunds (Purchase Behaviour → Refunds sub-tab) ────────────────────
const RF_REASONS = ['Customer changed mind', 'Did not like the product', 'Did not meet expectations', 'Duplicate purchase', 'Accidental purchase', 'Technical / access issue', 'Wanted a different product', 'Chargeback / dispute', 'Could not afford it', 'No longer needed', 'Other'];
let rfData = null;
let _rfSeq = 0;   // request token — discard stale responses when changing filters quickly
const RF_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Show the refund date as the SAME day the server buckets/filters it on — no Date()/timezone
// drift for naive SamCart strings; only tz-aware (Kajabi) strings go through Intl.
function rfDate(ts) {
  const s = String(ts || '');
  let ymd;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) ymd = s.slice(0, 10);
  else { try { ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(s)); } catch { ymd = s.slice(0, 10); } }
  const [Y, M, D] = ymd.split('-').map(Number);
  return (RF_MONTHS[M - 1] || '') + ' ' + D + ', ' + Y;
}

document.querySelectorAll('.pb-subnav .fx-subtab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.pb-subnav .fx-subtab').forEach(x => x.classList.toggle('active', x === b));
  const v = b.dataset.pbview;
  if ($('pbview-main')) $('pbview-main').hidden = v !== 'main';
  if ($('pbview-refunds')) $('pbview-refunds').hidden = v !== 'refunds';
  if (v === 'refunds') loadRefunds();
}));

async function loadRefunds() {
  const qs = new URLSearchParams();
  const sd = $('rf-start').value, ed = $('rf-end').value, src = $('rf-source').value, prod = $('rf-product').value;
  if (sd) qs.set('start_date', sd); if (ed) qs.set('end_date', ed); if (src) qs.set('source', src); if (prod) qs.set('product', prod);
  $('rf-rows').innerHTML = '<tr class="empty-row"><td colspan="7">Loading…</td></tr>';
  const seq = ++_rfSeq;
  try { const d = await api('/api/refunds?' + qs.toString()); if (seq !== _rfSeq) return; rfData = d; renderRefunds(rfData); }
  catch (e) { if (seq !== _rfSeq) return; $('rf-rows').innerHTML = `<tr class="empty-row"><td colspan="7">Could not load refunds: ${escHtml(e.message)}</td></tr>`; }
}

function renderRefunds(d) {
  const s = d.summary || {};
  $('rf-total').textContent = fmtMoney(s.total || 0);
  $('rf-count').textContent = fmtNum(s.count || 0);
  $('rf-sc').textContent = fmtMoney((s.bySource && s.bySource.SamCart) || 0);
  $('rf-kj').textContent = fmtMoney((s.bySource && s.bySource.Kajabi) || 0);
  $('rf-untagged').textContent = fmtNum(s.untagged || 0);

  const ban = $('rf-banner');
  if (d.reasonsTableMissing) { ban.hidden = false; ban.innerHTML = '⚠ Run <code>refunds-schema.sql</code> in Supabase once to enable saving reasons — refunds still show below.'; }
  else ban.hidden = true;

  const psel = $('rf-product'), cur = psel.value;
  psel.innerHTML = '<option value="">All products</option>' + (d.products || []).map(p => `<option value="${escHtml(p)}">${escHtml(p)}</option>`).join('');
  psel.value = (d.products || []).includes(cur) ? cur : '';

  const used = (d.byReason || []).map(r => r.reason).filter(r => r && r !== 'Untagged');
  const opts = [...new Set([...RF_REASONS, ...used])];
  const srcBadge = src => `<span class="rf-src rf-src-${String(src).toLowerCase()}">${escHtml(src)}</span>`;
  const rows = d.refunds || [];
  $('rf-rows').innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td class="rf-date-cell">${escHtml(rfDate(r.date))}</td>
      <td>${srcBadge(r.source)}</td>
      <td>${escHtml(r.product || 'Unknown')}</td>
      <td class="rf-cust">${escHtml(r.customer || '—')}</td>
      <td class="rf-amt">${fmtMoney(r.amount)}</td>
      <td>${r.status === 'Partial' ? '<span class="rf-partial">Partial</span>' : 'Full'}</td>
      <td><select class="rf-reason${r.reason ? '' : ' rf-reason-empty'}" data-key="${escHtml(r.id)}"${d.reasonsTableMissing ? ' disabled' : ''}>
        <option value="">— select reason —</option>
        ${opts.map(o => `<option value="${escHtml(o)}"${o === r.reason ? ' selected' : ''}>${escHtml(o)}</option>`).join('')}
      </select></td>
    </tr>`).join('') : '<tr class="empty-row"><td colspan="7">No refunds in this range.</td></tr>';

  buildRefundCharts(d);
}

function buildRefundCharts(d) {
  const reasons = d.byReason || [];
  mkChart('rf-reason-chart', {
    type: 'doughnut',
    data: { labels: reasons.map(r => r.reason), datasets: [{ data: reasons.map(r => r.amount), backgroundColor: reasons.map((r, i) => r.reason === 'Untagged' ? '#cbd5e1' : FA_COLORS[i % FA_COLORS.length]), borderWidth: 0, hoverOffset: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 9, font: { size: 11 }, color: TICK } }, tooltip: { callbacks: { label: c => ` ${c.label}: ${fmtMoney(c.parsed)} (${reasons[c.dataIndex].count} refund${reasons[c.dataIndex].count === 1 ? '' : 's'})` } } } },
  });
  const prods = (d.byProduct || []).slice(0, 10);
  mkChart('rf-product-chart', {
    type: 'bar',
    data: { labels: prods.map(p => p.product), datasets: [{ data: prods.map(p => p.amount), backgroundColor: prods.map((_, i) => FA_COLORS[i % FA_COLORS.length]), borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmtMoney(c.parsed.x) } } }, scales: { x: { grid: { color: GRID }, ticks: { font: { size: 10 }, color: TICK, callback: moneyTick }, beginAtZero: true }, y: { grid: { display: false }, ticks: { font: { size: 11 }, color: TICK } } } },
  });
}

if ($('rf-rows')) $('rf-rows').addEventListener('change', async e => {
  const sel = e.target.closest('.rf-reason'); if (!sel) return;
  const key = sel.dataset.key, reason = sel.value;
  sel.disabled = true;
  try {
    await fxPost('/api/refunds/reason', { key, reason });
    if (rfData) { const r = (rfData.refunds || []).find(x => x.id === key); if (r) r.reason = reason; recomputeRefundReasons(); }
    sel.classList.toggle('rf-reason-empty', !reason);
  } catch (err) { alert('Could not save reason: ' + err.message); }
  finally { sel.disabled = false; }
});
function recomputeRefundReasons() {
  const byReason = {}; let untagged = 0;
  for (const r of (rfData.refunds || [])) { const k = r.reason || 'Untagged'; (byReason[k] = byReason[k] || { amount: 0, count: 0 }); byReason[k].amount += r.amount; byReason[k].count++; if (!r.reason) untagged++; }
  rfData.byReason = Object.entries(byReason).map(([reason, v]) => ({ reason, amount: Math.round(v.amount * 100) / 100, count: v.count })).sort((a, b) => b.amount - a.amount);
  rfData.summary.untagged = untagged;
  $('rf-untagged').textContent = fmtNum(untagged);
  buildRefundCharts(rfData);
}

let _rfT;
['rf-start', 'rf-end', 'rf-source', 'rf-product'].forEach(id => { if ($(id)) $(id).addEventListener('change', () => { clearTimeout(_rfT); _rfT = setTimeout(loadRefunds, 150); }); });
if ($('rf-export')) $('rf-export').addEventListener('click', () => {
  if (!rfData || !rfData.refunds) return;
  const esc = v => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [['Date', 'Source', 'Product', 'Customer', 'Amount', 'Type', 'Reason'].join(','), ...rfData.refunds.map(r => [esc(String(r.date)), r.source, esc(r.product), esc(r.customer), r.amount, r.status, esc(r.reason)].join(','))];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = 'refunds.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ── Boot ──────────────────────────────────────────────────────────
async function refreshAll(force = false) {
  await Promise.allSettled([
    applyCompare(state.cmpPreset || 'mtd'),
    loadTrend(state.trendDays),
    loadPagesTable(),
    loadLiveFeed($('feedSearch').value.trim()),
    loadFunnel(),
    loadSamCart(force),
    loadSettings(),
    loadKajabiData(),
    loadMetaSpend(),
  ]);
}

$('refreshBtn').addEventListener('click', async () => {
  const btn = $('refreshBtn');
  btn.disabled = true;
  btn.classList.add('spinning');
  $('syncStatus').textContent = 'Refreshing…';
  try {
    await refreshAll(true);
    $('syncStatus').textContent = 'Refreshed ' + new Date().toLocaleTimeString();
  } catch (err) {
    $('syncStatus').textContent = 'Error: ' + err.message.slice(0, 60);
  } finally {
    btn.disabled = false;
    btn.classList.remove('spinning');
  }
});

refreshAll();

// Auto-refresh live feed every 30s
setInterval(() => loadLiveFeed($('feedSearch').value.trim()), 30000);
