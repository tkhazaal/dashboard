// Single source of truth for the app version + the "What's New" page.
// For each release, add a new entry at the TOP — APP_VERSION tracks the latest automatically.
const CHANGELOG = [
  {
    version: '1.21.0', date: '2026-06-28', title: 'Facebook followers in snapshot',
    changes: [
      { title: 'Facebook follower cards', detail: 'The Reporting Executive snapshot now shows current Facebook page followers and followers gained this month — via the Apify Facebook Pages scraper, snapshotted monthly so month-over-month growth tracks automatically (same as Instagram).' },
    ],
  },
  {
    version: '1.20.0', date: '2026-06-28', title: 'Upsells in funnel comparison',
    changes: [
      { title: 'Upsells in Period comparison', detail: 'The Funnels → Period comparison table now includes an Upsells column (current vs previous period, with % change), next to Unique Views, Checkout Views, Orders and Revenue — so you can see how upsell volume moved period over period.' },
    ],
  },
  {
    version: '1.19.0', date: '2026-06-28', title: 'Form submission source',
    changes: [
      { title: 'See which channel each submission came from', detail: 'Form Submissions now shows a Source column (the channel — Email, FB Post, IG Post, etc. — parsed from the form’s captured UTM), plus a “Submissions by source” summary at the top so you can instantly see which channel drove the most submissions.' },
    ],
  },
  {
    version: '1.18.0', date: '2026-06-28', title: 'List growth tracker',
    changes: [
      { title: 'Month-to-month list growth & loss', detail: 'On the Email page, pick any ActiveCampaign list to see subscribers gained vs lost each month and the active-subscriber trend over time — built from real join/unsubscribe dates. The dashboard also snapshots each list monthly so the trend stays exact going forward (very large lists show recent activity, noted).' },
    ],
  },
  {
    version: '1.17.0', date: '2026-06-28', title: 'ActiveCampaign lists + collapsible sections',
    changes: [
      { title: 'Contact lists', detail: 'The Email page now shows every ActiveCampaign list with its active subscriber count (and total contacts), sorted by size and searchable, with the grand total of active subscribers.' },
      { title: 'Collapsible sections', detail: 'Campaign performance and Automations are now collapsible — and collapsed by default — so the Email page stays compact. Click any section header to expand or collapse it.' },
    ],
  },
  {
    version: '1.16.0', date: '2026-06-28', title: 'Accurate email campaign attribution',
    changes: [
      { title: 'Email sales land under the right campaign', detail: 'When ActiveCampaign rewrites an email link’s tracking with its own email name (overwriting your campaign UTM), the dashboard now maps it back — so sales from a campaign’s email attribute to that campaign (channel Email, product pulled from the order), not the email’s name. Real order data, not estimates.' },
    ],
  },
  {
    version: '1.15.0', date: '2026-06-27', title: 'Refunds tracker',
    changes: [
      { title: 'Refunds sub-tab on Purchase Behaviour', detail: 'Every refund from SamCart & Kajabi in one place — source, date, product, amount and full/partial — with summary cards (total lost, count, by source) and filters by date, source and product. Export to CSV.' },
      { title: 'Tag why you refunded + “why” chart', detail: 'Pick a reason for each refund from a dropdown (saved to your database). A “Why we’re refunding” donut shows where the money is going, alongside a by-product breakdown — so you can see which products and which reasons are costing you most.' },
    ],
  },
  {
    version: '1.14.0', date: '2026-06-26', title: 'Form Submissions — Data Analysis',
    changes: [
      { title: 'Answer breakdowns', detail: 'A new Data Analysis sub-tab on the Form Submissions page: pick a form, then any question, and instantly see how its answers break down — counts and percentages — as a donut chart, a ranked bar chart, and a table with mini-bars. Perfect for "how many people chose X vs Y" (e.g. which product each person was approved for).' },
      { title: 'Download the breakdown', detail: 'Export any breakdown to CSV in one click. Works on forms of any size (paged past the 1,000-row limit) and counts each respondent once, so percentages always add up.' },
    ],
  },
  {
    version: '1.13.1', date: '2026-06-26', title: 'Fix: complete UTM data (channels were being dropped)',
    changes: [
      { title: 'All UTM views now counted', detail: 'The UTM report was silently capped at the newest 1,000 tracked views — under-counting busy channels and dropping low-traffic ones entirely (e.g. FB Stories & IG Stories on the Reconnection Compass campaign). It now pages through the full data, so every channel shows up with accurate view & unique counts — including channels that have views but no sales yet.' },
    ],
  },
  {
    version: '1.13.0', date: '2026-06-26', title: 'Form Submissions — delete + CSV export',
    changes: [
      { title: 'Download as CSV', detail: 'Export submissions to CSV — all at once, by the current search/filter, or one form at a time. Each question becomes its own column, so it opens cleanly in Excel/Sheets.' },
      { title: 'Delete submissions', detail: 'Delete a single submission (from its popup) or wipe all submissions for a whole form. Webhooks also moved to their own sub-tab so the main view stays clean.' },
    ],
  },
  {
    version: '1.12.0', date: '2026-06-26', title: 'Form Submissions + webhooks',
    changes: [
      { title: 'Create your own webhooks', detail: 'A new Form Submissions page where you create a webhook URL in one click and paste it into any software (GHL, Typeform, etc.). Every form/quiz submission sent to it is captured and saved automatically.' },
      { title: 'Auto-grouped forms, renameable', detail: 'Submissions are grouped into forms automatically (by the form name in the payload, else the webhook). Rename any form in-place. Each submission stores the full raw payload + a clean question/answer list.' },
      { title: 'Search a lead instantly', detail: "Search by name or email to pull up a lead's submissions on a call — click one to see their questions & answers in a clean popup." },
    ],
  },
  {
    version: '1.11.0', date: '2026-06-26', title: 'Instagram follower tracking',
    changes: [
      { title: 'Instagram cards live', detail: 'The Reporting snapshot now shows current Instagram followers and followers gained this month, via the Apify Instagram scraper. It snapshots once a month so month-over-month follower growth is tracked automatically.' },
      { title: 'Apify credentials in Settings', detail: 'The Apify token + Instagram username are stored securely in the database (masked, never in code), like the other integrations.' },
    ],
  },
  {
    version: '1.10.0', date: '2026-06-26', title: 'Revenue executive snapshot',
    changes: [
      { title: 'Executive KPI cards', detail: 'The Reporting page now opens with a business-wide snapshot (SamCart + Kajabi): Revenue today / MTD / 30-day, Orders today, AOV, ROAS MTD, Ad spend today, Revenue-by-source MTD, and Acquisition (ads vs organic). Fixed periods, independent of the date filter below.' },
      { title: 'Placeholders for pending metrics', detail: 'CSE, LTV:CAC, 90-day new customers and Instagram follower cards are in place with "?" notes — they fill in once their definition / the Instagram (P5) API is added.' },
    ],
  },
  {
    version: '1.9.0', date: '2026-06-26', title: 'Funnel period comparison',
    changes: [
      { title: 'Compare day-by-day / week-by-week', detail: 'On the Funnels page, click "⇄ Compare" to see the selected range vs the previous period of equal length — pick Today for day-over-day, This week for week-over-week, etc. Each channel shows current vs previous for Unique Views, Checkout Views, Orders and Revenue, with the % change.' },
    ],
  },
  {
    version: '1.8.0', date: '2026-06-26', title: 'Channel × Product breakdown + date picker',
    changes: [
      { title: 'Channel × Product', detail: 'On the UTM page, pick a campaign and see how each channel performed per product — channel-level views & unique, then per-product checkout views, orders and revenue. Answers "which channel sold which product."' },
      { title: 'Prominent date range', detail: 'A big from/to date picker (plus Today / This week / Last month / This year presets) on the UTM page — all UTM data follows the selected dates.' },
      { title: 'Orders from SamCart UTM capture', detail: 'After enabling UTM tracking in SamCart settings, each order now carries its channel; the dashboard reads it directly and attributes orders by channel and product on every sync — real data, no guesswork.' },
      { title: 'Historical estimate', detail: 'Orders placed before UTM capture was enabled (no channel on the order) are time-matched to the checkout visits for that product/day and shown as a clearly-labelled "(est)" — real UTM always takes precedence.' },
    ],
  },
  {
    version: '1.7.0', date: '2026-06-26', title: 'UTM orders via thank-you-page tracking',
    changes: [
      { title: 'Orders attributed by channel', detail: 'The UTM page now counts orders per channel using your own page tracking — a buyer\'s checkout visit (which carries the channel) plus their purchase-confirmation page view = one attributed sale. This works even though SamCart doesn\'t save the UTM on the order.' },
      { title: 'Add the snippet to your thank-you page', detail: 'Paste the tracking snippet on your post-purchase / order-confirmation page (just like the quiz). From then on, every campaign sale shows up in the UTM table by channel.' },
      { title: 'Eastern Time everywhere', detail: 'All days, months and date filters — page views, SamCart, Kajabi — now report on Eastern Time (EST/EDT) instead of UTC.' },
    ],
  },
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
