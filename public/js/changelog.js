// Single source of truth for the app version + the "What's New" page.
// For each release, add a new entry at the TOP — APP_VERSION tracks the latest automatically.
const CHANGELOG = [
  {
    version: '1.35.0', date: '2026-07-01', title: 'ManyChat: real growth-tool names, keyword tracking, recent optins',
    changes: [
      { title: 'Connect your ManyChat API key', detail: 'Settings → ManyChat now takes your API key (read-only). The dashboard uses it to pull your real growth-tool names — so the ManyChat tab shows “Facebook Comments #91” instead of a raw id, and the post “ManyChat ref” field on Social Report autocompletes real names as you type.' },
      { title: 'Keyword tracking', detail: 'A new “By keyword” table on the ManyChat tab, plus a keyword column in Recent optins. ManyChat doesn’t expose the matched keyword after the fact, so send it explicitly — set a Custom Field at the point your flow matches the keyword, then include it in the External Request body (instructions shown on the page).' },
      { title: 'Recent optins feed', detail: 'A live feed of the latest optins/CTA clicks — name, growth tool, channel, keyword and when — plus a browsable list of every growth tool on your account.' },
    ],
  },
  {
    version: '1.34.0', date: '2026-07-01', title: 'Track clicks to external pages (Skool, etc.)',
    changes: [
      { title: 'Tracked redirect links', detail: 'UTM campaigns only showed up when traffic landed on a page with your tracking snippet — so links to third-party sites (Skool, Calendly) were invisible. The UTM Link Builder now also gives a “tracked redirect link”: it routes the click through your domain (logging the UTM), then forwards to the destination. Use it for any page you can’t install tracking on, and those campaigns now appear in UTM Traffic.' },
    ],
  },
  {
    version: '1.33.0', date: '2026-07-01', title: 'SamCart products page + column alignment fixes',
    changes: [
      { title: 'New SamCart page', detail: 'A dedicated SamCart tab listing every product with its units, revenue, average price and share of revenue — with a date-range filter (today → all time), search, sortable columns, a top-products chart, and an upsell-products table. Just like SamCart Analytics, from your synced order data.' },
      { title: 'Table alignment cleanup', detail: 'Fixed numeric column headers that were sitting slightly off from their values (Social, ManyChat, Refunds “Amount”, Forms “People/%”) — headers now line up over their numbers.' },
    ],
  },
  {
    version: '1.32.0', date: '2026-07-01', title: 'ManyChat gets its own tab',
    changes: [
      { title: 'Dedicated ManyChat page', detail: 'The ManyChat optins panel (webhook URL, totals, by growth tool, by ref, by channel) now lives in its own “ManyChat” tab in the sidebar. Per-post optins still show on the Social Report.' },
    ],
  },
  {
    version: '1.31.0', date: '2026-07-01', title: 'ManyChat optin tracking on Social Report',
    changes: [
      { title: 'Track optins from your posts', detail: 'A new ManyChat panel on the Social Report shows optins (and CTA clicks) collected via webhook — totals, a breakdown by ref/CTA, and by channel. Copy the webhook URL into a ManyChat “External Request” action so each optin flows in with a ref tag.' },
      { title: 'Per-post optins', detail: 'Give a post a “ManyChat ref” and its optins (and optin-rate vs views) show right on the card and in the table — so you can see which posts and CTAs actually drive subscribers. (One-time setup: run manychat-schema.sql in Supabase.)' },
    ],
  },
  {
    version: '1.30.0', date: '2026-07-01', title: 'Overview KPIs use live Meta ad spend',
    changes: [
      { title: 'Real ad spend across the dashboard', detail: 'Now that Meta Ads is connected, the Overview cards — Ad spend today, ROAS MTD, CAC (90d) and LTV:CAC — pull your actual Meta spend instead of the manual budget tracker. ROAS MTD becomes a true blended ROAS: real SamCart + Kajabi revenue ÷ live Meta ad spend. (If Meta isn’t connected, these fall back to manual budgets as before.)' },
      { title: 'Purchase metric fix', detail: 'Meta returns several overlapping purchase types; the dashboard now uses the de-duplicated total (omni_purchase) instead of summing them, so purchase counts match Ads Manager.' },
    ],
  },
  {
    version: '1.29.0', date: '2026-06-30', title: 'Meta (Facebook) Ads reporting',
    changes: [
      { title: 'Live Meta Ads on the Ads page', detail: 'Connect your Meta ad account (Settings → Meta Ads) and the Ads page pulls live spend, ROAS, purchases, cost-per-purchase, impressions, reach, clicks, CTR, CPC, CPM and frequency — with a 90-day spend & ROAS trend and a per-campaign table. Pick the range (today → maximum) and refresh on demand. Read-only; your campaigns are never touched.' },
      { title: 'Secure, long-term connection', detail: 'Uses a Meta System User access token (never expires) stored in Settings just like your other keys — masked on screen, kept in the database, never in code. Optional App Secret adds appsecret_proof. Until you connect, the page shows a simple “Connect Meta Ads” prompt.' },
    ],
  },
  {
    version: '1.28.0', date: '2026-06-30', title: 'Sales Alerts — week-over-week drop notifications',
    changes: [
      { title: 'New Alerts page (notification center)', detail: 'A new “Alerts” item in the sidebar (with a live count badge) flags every channel or campaign where sales dropped vs the previous week. Each alert reads like “Cut of Culture · IG Post — Revenue ↓ 52.4%: $389 (Jun 22–28) down from $818 (Jun 15–21)”, with a summary of how much revenue is down overall. Click “↻ Update” to re-pull SamCart and recompare on the spot.' },
      { title: 'Flexible comparisons & thresholds', detail: 'Compare the last full week vs the prior week (default), this week vs last week so far, or today vs the same weekday last week — Monday-start weeks, Eastern time. Break down by campaign × channel or by channel/post-type (IG Post, FB Post, Email…), filter to Revenue / Orders / Upsells, and set the alert threshold (≥10/20/25/50% drop). A small noise floor keeps tiny blips out.' },
      { title: 'Upsell tracking by channel', detail: 'SamCart upsell revenue is now tracked per channel per day so upsell drops show up in Alerts too (populates after the next SamCart sync). Downsells are counted within upsells. Revenue & order alerts work immediately.' },
    ],
  },
  {
    version: '1.27.0', date: '2026-06-30', title: 'Social Report: 3 views, filters & engagement metrics',
    changes: [
      { title: 'Cards / Table / Calendar views', detail: 'Toggle between a compact card feed, a full metrics table, and a month calendar (posts placed on the day they went out — use ‹ › to move between months). Cards are smaller now, captions collapse with “more/less”, each post shows when its metrics were last updated, and a “Load more” button keeps the page short as posts pile up.' },
      { title: 'Filters, sorting & date ranges', detail: 'Filter by platform, type or search; sort by top views / likes / comments / shares / engagement; and pick a date range (This month, Last month, Last 30 / 90 days, All time). The summary totals, charts and top-posts all update to match what you’ve filtered.' },
      { title: 'Engagement metrics', detail: 'Every post now shows derived metrics — Engagement Rate (engagement ÷ views), Comment % and Share % (vs views), Resonance ((comments+shares) ÷ likes — how much it sparks real interaction vs passive likes) and Virality (shares ÷ engagement). Full set in the Table view and the CSV. Calmer chart colours, and Status was removed.' },
    ],
  },
  {
    version: '1.26.0', date: '2026-06-30', title: 'Social Report (Facebook + Instagram)',
    changes: [
      { title: 'New Social Report page', detail: 'Pulls your Facebook & Instagram posts and reels via Apify — views, likes, comments and shares auto-update every day at 8am, with a live progress bar when scraping. Summary totals, a views-by-platform donut and a top-posts chart, plus a visual card per post (thumbnail + metrics) where you can add your own Hook/Topic, Offer, Status, Post # and Notes. Export to CSV. (One-time setup: run social-schema.sql in Supabase.)' },
    ],
  },
  {
    version: '1.25.0', date: '2026-06-30', title: 'Bulk-delete form submissions',
    changes: [
      { title: 'Select & delete in bulk', detail: 'Form Submissions now has a checkbox on every row (plus a select-all in the header). Tick the ones you want and click “Delete selected” to remove them all at once — respects the current search/form filter.' },
    ],
  },
  {
    version: '1.24.0', date: '2026-06-28', title: 'Funnels: reorder, collapse & per-channel comparison',
    changes: [
      { title: 'Drag to reorder groups + click to expand', detail: 'Funnel groups now have a drag handle (⠿) — drag a group up or down to set your own order. Groups start collapsed and expand when you click anywhere on the group row (not just the small arrow).' },
      { title: 'Per-channel period comparison', detail: 'The Funnels period comparison now breaks each group down by channel — every platform shows current vs previous (views, checkout, orders, upsells, revenue) beneath its group total.' },
    ],
  },
  {
    version: '1.23.0', date: '2026-06-28', title: 'Refund customer emails',
    changes: [
      { title: 'Every refund shows the buyer', detail: 'Refunds paid by card now show the customer email (and name) too — not just PayPal ones. The dashboard looks each refunded customer up by ID, so all refunds are identifiable instead of showing a blank.' },
    ],
  },
  {
    version: '1.22.0', date: '2026-06-28', title: 'Apify credentials in Settings',
    changes: [
      { title: 'Edit your Apify token + social accounts', detail: 'Settings now has fields for your Apify personal token, Instagram username and Facebook page URL — so you can update the follower-tracking credentials yourself. The token is stored securely and only ever shown masked. Saving re-syncs Instagram & Facebook automatically.' },
      { title: 'Snapshot in a 4-column grid', detail: 'The Executive snapshot KPI cards now sit in a tidy 4×4 grid.' },
    ],
  },
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
