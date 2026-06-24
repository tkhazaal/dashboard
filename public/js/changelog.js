// Single source of truth for the app version + the "What's New" page.
// For each release, add a new entry at the TOP — APP_VERSION tracks the latest automatically.
const CHANGELOG = [
  {
    version: '1.6.0', date: '2026-06-24', title: 'UTM tracking & channel attribution',
    changes: [
      { title: 'UTM & Links tab', detail: 'A new page to build tagged campaign links and track traffic by channel type (FB Post, IG Stories, Email, TikTok…), auto-detected from each link\'s utm_content. New channel types appear automatically — no setup.' },
      { title: 'Channel funnel', detail: 'See the full journey per channel — Views → Unique → Checkout Views → Orders — so you know which channel actually drives sales, not just clicks.' },
      { title: 'Checkout Views & Orders in Campaign detail', detail: 'Every source/medium/campaign/content row shows its checkout views and orders, matched from the UTM that carries through to the SamCart checkout.' },
      { title: 'Per-page Refresh buttons', detail: 'Each report tab has its own ↻ Refresh that reloads just that page\'s data.' },
      { title: 'Page Analytics by date', detail: 'Orders and order value now follow the selected date range instead of always showing all-time.' },
      { title: 'Total Revenue by period + help tips', detail: 'Overview Total Revenue now reflects the selected date range (SamCart + Kajabi), and every card has a "?" explaining what it shows.' },
    ],
  },
  {
    version: '1.5.0', date: '2026-06-23', title: 'Kajabi & Email integrations',
    changes: [
      { title: 'Kajabi tab', detail: 'Revenue, orders, top offers, contacts, subscriptions, refunds, and member login/engagement — pulled straight from Kajabi.' },
      { title: 'Email tab (ActiveCampaign)', detail: 'Campaign performance (open / click / click-to-open / unsubscribe / bounce), deliverability, automations and list health, with filters and visual breakdowns.' },
      { title: 'Reporting by source & date', detail: 'Switch the Reporting page between SamCart and Kajabi, and filter by any date range.' },
      { title: 'Manage integrations in Settings', detail: 'Add or replace your Kajabi and ActiveCampaign API keys directly from Settings — stored securely, never in code.' },
      { title: 'Monthly goal includes Kajabi', detail: 'The Monthly Revenue Goal now counts SamCart + Kajabi sales toward the target, with a per-source breakdown.' },
    ],
  },
  {
    version: '1.4.0', date: '2026-06-22', title: 'Funnels, Ads & branding',
    changes: [
      { title: 'Ads & ROAS tab', detail: 'Set each campaign\'s daily or total budget and see spend, revenue and ROAS for any date range.' },
      { title: 'Funnels upgrades', detail: 'Date-range presets, auto-filled channel groups, delete confirmation, and a compact table that fits on screen.' },
      { title: 'Channel-labelled pages', detail: 'Landing and checkout pages now show their channel name (IG Posts, FB Ads…) instead of raw URL slugs.' },
      { title: 'Cleaner traffic counts', detail: 'GoHighLevel order-confirmation pages no longer inflate your view counts.' },
      { title: 'Branding', detail: 'Your Tania Khazaal logo and a matching favicon.' },
    ],
  },
  {
    version: '1.0.0', date: '2026-06-18', title: 'Initial dashboard',
    changes: [
      { title: 'Core analytics', detail: 'Landing-page tracking, SamCart revenue / LTV / refunds / upsells, conversion funnels, customer & product reporting, and a monthly revenue goal.' },
    ],
  },
];
const APP_VERSION = (CHANGELOG[0] && CHANGELOG[0].version) || '1.0.0';
