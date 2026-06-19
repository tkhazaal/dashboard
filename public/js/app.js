'use strict';

// ── Helpers ──────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
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
  '/fathers-repair-playbook':     'FB Posts',
  '/the-fathers-repair-playbook': 'FB Stories',
  '/fathers-repair-guide':        'IG Posts',
  '/the-fathers-repair-guide':    'IG Stories',
  '/fathers-repair-system':       'Emails',
  '/the-fathers-repair-system':   'TikTok',
  '/fathers-repair-bundle':       'FB Group',
  '/fathers-repair-play-book':    'FB Ads',
};
const campaignName = path => {
  const key = String(path || '').replace(/\/+$/, '').toLowerCase() || '/';
  return CAMPAIGN_LABELS[key] || null;
};

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
  paDays:      30,
  paStart:     '',
  paEnd:       '',
  paSearch:    '',
  paSort:      'total_views',
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
};

// ── Tab navigation ────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    item.classList.add('active');
    $(`tab-${item.dataset.tab}`).classList.add('active');
  });
});

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
        { label: 'Page Views',      data: rows.map(r=>r.views),           borderColor: '#5b6af0', backgroundColor: 'rgba(91,106,240,0.08)', fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 5 },
        { label: 'Unique Visitors', data: rows.map(r=>r.unique_visitors),  borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.06)', fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 5 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#9ca3af', maxTicksLimit: 12 } },
        y: { grid: { color: 'rgba(148,163,184,0.18)' }, ticks: { font: { size: 11 }, color: '#9ca3af' }, beginAtZero: true }
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
      datasets: [{ data: [single, repeat], backgroundColor: ['#e8eaf0', '#5b6af0'], borderWidth: 0, hoverOffset: 6 }]
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
      <div class="legend-item"><div class="legend-dot" style="background:#5b6af0"></div>Repeat (${fmtNum(repeat)})</div>
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
        { type: 'bar',  label: 'Revenue', data: rows.map(r=>r.revenue), backgroundColor: 'rgba(91,106,240,0.85)', borderRadius: 4, yAxisID: 'y',  order: 2 },
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
        x:  { grid: { display: false }, ticks: { font: { size: 11 }, color: '#9ca3af' } },
        y:  { position: 'left',  grid: { color: 'rgba(148,163,184,0.18)' }, ticks: { font: { size: 11 }, color: '#9ca3af', callback: v => '$' + (v >= 1000 ? (v/1000)+'k' : v) }, beginAtZero: true },
        y1: { position: 'right', grid: { display: false },   ticks: { font: { size: 11 }, color: '#10b981' }, beginAtZero: true }
      }
    }
  });
}

function renderSalesAnalytics(d) {
  if (!d) return;
  renderGoal();
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
async function loadOverviewStats(days) {
  const p = days > 0 ? `?days=${days}` : '';
  const overview = await api(`/api/analytics/overview${p}`);
  $('ov-totalViews').textContent     = fmtNum(overview.totalViews);
  $('ov-uniqueVisitors').textContent = fmtNum(overview.uniqueVisitors);
  $('ov-todayViews').textContent     = `${fmtNum(overview.todayViews)} today`;
  $('ov-todayUnique').textContent    = `${fmtNum(overview.todayUnique)} today`;
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

async function loadPagesTable() {
  const params = paRangeParams();
  const rows = await api(`/api/analytics/pages?${params}`);
  state.pagesData = rows;
  renderPagesTable(rows);

  // Referrers + stat cards share the same date filter
  const refs = await api(`/api/analytics/referrers?${params}`);
  renderReferrersTable(refs);
  loadPaStats();
}

function renderPagesTable(rows) {
  // Client-side search — matches campaign name, path, or page title
  let filtered = rows;
  if (state.paSearch) {
    const q = state.paSearch.toLowerCase();
    filtered = rows.filter(p =>
      (campaignName(p.page_path) || '').toLowerCase().includes(q) ||
      String(p.page_path  || '').toLowerCase().includes(q) ||
      String(p.page_title || '').toLowerCase().includes(q)
    );
  }

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (state.paSort === 'unique_visitors') return b.unique_visitors - a.unique_visitors;
    return b.total_views - a.total_views;
  });

  $('pa-resultCount').textContent = `${fmtNum(sorted.length)} page${sorted.length !== 1 ? 's' : ''}`;

  const body = $('pagesTable');
  body.innerHTML = sorted.length === 0
    ? `<tr class="empty-row"><td colspan="5">No page views yet — add the tracking code to your pages.</td></tr>`
    : sorted.map((p, i) => {
        const label = campaignName(p.page_path);
        return `
        <tr>
          <td class="rank">${i + 1}</td>
          <td>
            <div class="name-cell">${escHtml(label || p.page_title || p.page_path)}</div>
            <div class="email-cell">${escHtml(p.page_path)}</div>
          </td>
          <td>${fmtNum(p.total_views)}</td>
          <td>${fmtNum(p.unique_visitors)}</td>
          <td class="email-cell">${timeAgo(p.last_seen)}</td>
        </tr>
      `;}).join('');
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

  // Overview
  $('ov-totalCustomers').textContent = fmtNum(data.totalCustomers);
  $('ov-totalRevenue').textContent   = fmtMoney(data.totalRevenue);
  $('ov-avgLtv').innerHTML           = data.momRevenue != null
    ? momHtml(data.momRevenue)
    : `Avg LTV: ${fmtMoneyFull(data.avgLtv)}`;

  if (data.syncedAt) {
    const label = data.isDemo ? 'Demo data — update API key in Settings' :
                  data.stale  ? 'Stale cache — ' :
                  data.fromCache ? 'Cached — ' : 'Live — ';
    $('scSyncedAt').textContent = label + (data.isDemo ? '' : timeAgo(data.syncedAt));
    $('scSyncedAt').style.background = data.isDemo ? '#fef3c7' : '';
    $('scSyncedAt').style.color      = data.isDemo ? '#92400e' : '';
  }

  buildBuyerSplitChart(data.singleBuyers, data.repeatBuyers);
  renderSalesAnalytics(data);
  renderCustomers();
  renderTiers(data.tiers);
  renderBehaviour(data);
  renderPaths();
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
  state.monthlyGoal = parseFloat(s.monthly_goal) || 0;
  updateTrackingCode(s.tracker_url || 'http://localhost:3000');
  renderGoal();
}

// ── Monthly goal progress ─────────────────────────────────────────
function renderGoal() {
  const goal = state.monthlyGoal || 0;
  const mtd  = state.scData?.monthToDate;
  const current = mtd?.revenue || 0;

  // Current month label
  const now = new Date();
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

  if (reached) {
    $('goal-meta').innerHTML = `<span class="delta up">🎉 Goal reached!</span> ${fmtMoney(current - goal)} over target with ${daysLeft} days to spare.`;
  } else {
    const perDay = daysLeft > 0 ? remaining / daysLeft : remaining;
    $('goal-meta').innerHTML = `<strong>${fmtMoney(remaining)}</strong> to go · ${daysLeft} day${daysLeft!==1?'s':''} left · need <strong>${fmtMoney(Math.round(perDay))}/day</strong> to hit target`;
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
    setTimeout(() => { $('settingsSaved').textContent = ''; }, 3000);
    updateTrackingCode(body.tracker_url || 'http://localhost:3000');
    if (body.monthly_goal !== undefined) {
      state.monthlyGoal = parseFloat(body.monthly_goal) || 0;
      $('goal-input').value = state.monthlyGoal || '';
      renderGoal();
    }
    if (body.samcart_api_key) loadSamCart(true);
  }
});

$('copyCodeBtn').addEventListener('click', () => {
  navigator.clipboard.writeText($('trackingCode').textContent).then(() => {
    $('copyCodeBtn').textContent = 'Copied!';
    setTimeout(() => { $('copyCodeBtn').textContent = 'Copy'; }, 2000);
  });
});

// ── Sync button ───────────────────────────────────────────────────
$('syncBtn').addEventListener('click', async () => {
  $('syncBtn').disabled = true;
  $('syncStatus').textContent = 'Starting sync…';
  try {
    const r = await fetch('/api/samcart/sync', { method: 'POST' });
    const j = await r.json();
    if (j.error) throw new Error(j.error);

    // Background sync — poll status until it finishes (full crawl takes minutes)
    await new Promise((resolve) => {
      const poll = setInterval(async () => {
        try {
          const s = await api('/api/samcart/sync/status');
          if (s.running) {
            $('syncStatus').textContent = `Syncing… ${fmtNum(s.orderCount)} orders`;
          } else {
            clearInterval(poll);
            if (s.error) $('syncStatus').textContent = 'Error: ' + s.error.slice(0, 50);
            else         $('syncStatus').textContent = `Synced ${fmtNum(s.orderCount)} orders ✓`;
            await loadSamCart(true);
            resolve();
          }
        } catch { /* keep polling */ }
      }, 3000);
    });
  } catch (err) {
    $('syncStatus').textContent = 'Error: ' + err.message.slice(0, 60);
  } finally {
    $('syncBtn').disabled = false;
  }
});

// ── Wire up Overview filters ──────────────────────────────────────
initDateBtns('ov-dateBtns', days => {
  state.ovDays = days;
  loadOverviewStats(days);
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

// ── Boot ──────────────────────────────────────────────────────────
async function refreshAll(force = false) {
  await Promise.allSettled([
    loadOverviewStats(state.ovDays),
    loadTrend(state.trendDays),
    loadPagesTable(),
    loadLiveFeed($('feedSearch').value.trim()),
    loadSamCart(force),
    loadSettings(),
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
