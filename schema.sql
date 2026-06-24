-- ============================================================
-- Run this entire file in Supabase → SQL Editor → New Query
-- ============================================================

-- ── Tables ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS page_views (
  id         BIGSERIAL   PRIMARY KEY,
  page_url   TEXT        NOT NULL,
  page_path  TEXT        NOT NULL,
  page_title TEXT,
  visitor_id TEXT        NOT NULL,
  session_id TEXT        NOT NULL,
  referrer   TEXT,
  user_agent TEXT,
  ip_address TEXT,
  screen_res TEXT,
  timezone   TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pv_created  ON page_views(created_at);
CREATE INDEX IF NOT EXISTS idx_pv_path     ON page_views(page_path);
CREATE INDEX IF NOT EXISTS idx_pv_visitor  ON page_views(visitor_id);

CREATE TABLE IF NOT EXISTS samcart_cache (
  cache_key  TEXT        PRIMARY KEY,
  data       TEXT        NOT NULL,
  cached_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT        PRIMARY KEY,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO settings (key, value)
VALUES
  ('site_name',    'My Dashboard'),
  ('tracker_url',  'http://localhost:3000'),
  ('monthly_goal', '80000')
ON CONFLICT (key) DO NOTHING;


-- ── Analytics functions (called via RPC) ──────────────────
-- All functions accept an optional explicit date range (start_date / end_date,
-- 'YYYY-MM-DD'). When provided it takes priority over days_back.
-- Re-running this section is safe — it only redefines functions, never data.

DROP FUNCTION IF EXISTS analytics_overview(INT);
DROP FUNCTION IF EXISTS analytics_overview(INT, TEXT, TEXT);
CREATE FUNCTION analytics_overview(days_back INT DEFAULT 0, start_date TEXT DEFAULT '', end_date TEXT DEFAULT '')
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  dc TEXT := '';
  result JSON;
BEGIN
  -- Report on Eastern Time: cast/compare day boundaries in America/New_York
  -- (CURRENT_DATE, NOW() and ::date all honour this session setting).
  SET LOCAL TimeZone = 'America/New_York';
  IF start_date <> '' AND end_date <> '' THEN
    dc := format('AND created_at::date BETWEEN %L AND %L', start_date, end_date);
  ELSIF days_back = 1 THEN
    dc := 'AND created_at::date = CURRENT_DATE';
  ELSIF days_back > 1 THEN
    dc := format('AND created_at >= NOW() - INTERVAL ''%s days''', days_back);
  END IF;

  -- Exclude GoHighLevel /complete/<id> order-confirmation pages from view counts
  EXECUTE format('
    SELECT json_build_object(
      ''totalViews'',     (SELECT COUNT(*)::int               FROM page_views WHERE page_path NOT LIKE ''/complete/%%'' %1$s),
      ''uniqueVisitors'', (SELECT COUNT(DISTINCT visitor_id)::int FROM page_views WHERE page_path NOT LIKE ''/complete/%%'' %1$s),
      ''uniqueSessions'', (SELECT COUNT(DISTINCT session_id)::int FROM page_views WHERE page_path NOT LIKE ''/complete/%%'' %1$s),
      ''todayViews'',     (SELECT COUNT(*)::int               FROM page_views WHERE created_at::date = CURRENT_DATE AND page_path NOT LIKE ''/complete/%%''),
      ''todayUnique'',    (SELECT COUNT(DISTINCT visitor_id)::int FROM page_views WHERE created_at::date = CURRENT_DATE AND page_path NOT LIKE ''/complete/%%''),
      ''weekViews'',      (SELECT COUNT(*)::int               FROM page_views WHERE created_at >= NOW() - INTERVAL ''7 days'' AND page_path NOT LIKE ''/complete/%%''),
      ''monthViews'',     (SELECT COUNT(*)::int               FROM page_views WHERE created_at >= NOW() - INTERVAL ''30 days'' AND page_path NOT LIKE ''/complete/%%'')
    )', dc)
  INTO result;

  RETURN result;
END;
$$;


DROP FUNCTION IF EXISTS analytics_pages(INT, TEXT);
DROP FUNCTION IF EXISTS analytics_pages(INT, TEXT, TEXT, TEXT);
CREATE FUNCTION analytics_pages(days_back INT DEFAULT 0, search_term TEXT DEFAULT '', start_date TEXT DEFAULT '', end_date TEXT DEFAULT '')
RETURNS TABLE(
  page_path       TEXT,
  page_title      TEXT,
  host            TEXT,
  total_views     INT,
  unique_visitors INT,
  sessions        INT,
  last_seen       TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  dc TEXT := '';
  sc TEXT := '';
BEGIN
  -- Report on Eastern Time: cast/compare day boundaries in America/New_York
  -- (CURRENT_DATE, NOW() and ::date all honour this session setting).
  SET LOCAL TimeZone = 'America/New_York';
  IF start_date <> '' AND end_date <> '' THEN
    dc := format('AND created_at::date BETWEEN %L AND %L', start_date, end_date);
  ELSIF days_back = 1 THEN
    dc := 'AND created_at::date = CURRENT_DATE';
  ELSIF days_back > 1 THEN
    dc := format('AND created_at >= NOW() - INTERVAL ''%s days''', days_back);
  END IF;

  IF search_term <> '' THEN
    sc := format('AND (pv.page_path ILIKE ''%%%s%%'' OR pv.page_title ILIKE ''%%%s%%'')', search_term, search_term);
  END IF;

  -- Group by host as well as path so checkout pages on a different domain
  -- (e.g. *.samcart.com) never merge with a landing page that shares a slug.
  RETURN QUERY EXECUTE format('
    SELECT pv.page_path, pv.page_title,
      split_part(split_part(pv.page_url, ''://'', 2), ''/'', 1) AS host,
      COUNT(*)::int                   AS total_views,
      COUNT(DISTINCT visitor_id)::int AS unique_visitors,
      COUNT(DISTINCT session_id)::int AS sessions,
      MAX(created_at)                 AS last_seen
    FROM page_views pv
    WHERE pv.page_path NOT LIKE ''/complete/%%'' %s %s
    GROUP BY pv.page_path, pv.page_title, split_part(split_part(pv.page_url, ''://'', 2), ''/'', 1)
    ORDER BY total_views DESC
    LIMIT 100
  ', dc, sc);
END;
$$;


DROP FUNCTION IF EXISTS analytics_trend(INT);
DROP FUNCTION IF EXISTS analytics_trend(INT, TEXT, TEXT);
CREATE FUNCTION analytics_trend(days_back INT DEFAULT 30, start_date TEXT DEFAULT '', end_date TEXT DEFAULT '')
RETURNS TABLE(day DATE, views INT, unique_visitors INT)
LANGUAGE plpgsql
AS $$
DECLARE
  wc TEXT := '';
BEGIN
  -- Report on Eastern Time: cast/compare day boundaries in America/New_York
  -- (CURRENT_DATE, NOW() and ::date all honour this session setting).
  SET LOCAL TimeZone = 'America/New_York';
  IF start_date <> '' AND end_date <> '' THEN
    wc := format('WHERE created_at::date BETWEEN %L AND %L', start_date, end_date);
  ELSIF days_back > 0 THEN
    wc := format('WHERE created_at >= NOW() - INTERVAL ''%s days''', days_back);
  END IF;

  -- Exclude GoHighLevel /complete/<id> confirmation pages from the trend
  IF wc = '' THEN
    wc := 'WHERE page_path NOT LIKE ''/complete/%''';
  ELSE
    wc := wc || ' AND page_path NOT LIKE ''/complete/%''';
  END IF;

  RETURN QUERY EXECUTE format('
    SELECT
      created_at::date          AS day,
      COUNT(*)::int             AS views,
      COUNT(DISTINCT visitor_id)::int AS unique_visitors
    FROM page_views %s
    GROUP BY created_at::date
    ORDER BY day ASC
  ', wc);
END;
$$;


DROP FUNCTION IF EXISTS analytics_recent(INT, TEXT);
DROP FUNCTION IF EXISTS analytics_recent(INT, TEXT, TEXT, TEXT);
CREATE FUNCTION analytics_recent(days_back INT DEFAULT 0, page_filter TEXT DEFAULT '', start_date TEXT DEFAULT '', end_date TEXT DEFAULT '')
RETURNS TABLE(page_path TEXT, page_title TEXT, referrer TEXT, ip_address TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
AS $$
DECLARE
  dc TEXT := '';
  pc TEXT := '';
BEGIN
  -- Report on Eastern Time: cast/compare day boundaries in America/New_York
  -- (CURRENT_DATE, NOW() and ::date all honour this session setting).
  SET LOCAL TimeZone = 'America/New_York';
  IF start_date <> '' AND end_date <> '' THEN
    dc := format('AND created_at::date BETWEEN %L AND %L', start_date, end_date);
  ELSIF days_back = 1 THEN
    dc := 'AND created_at::date = CURRENT_DATE';
  ELSIF days_back > 1 THEN
    dc := format('AND created_at >= NOW() - INTERVAL ''%s days''', days_back);
  END IF;

  IF page_filter <> '' THEN
    pc := format('AND page_path ILIKE ''%%%s%%''', page_filter);
  END IF;

  RETURN QUERY EXECUTE format('
    SELECT pv.page_path, pv.page_title, pv.referrer, pv.ip_address, pv.created_at
    FROM page_views pv
    WHERE 1=1 %s %s
    ORDER BY created_at DESC LIMIT 50
  ', dc, pc);
END;
$$;


DROP FUNCTION IF EXISTS analytics_referrers(INT);
DROP FUNCTION IF EXISTS analytics_referrers(INT, TEXT, TEXT);
CREATE FUNCTION analytics_referrers(days_back INT DEFAULT 0, start_date TEXT DEFAULT '', end_date TEXT DEFAULT '')
RETURNS TABLE(source TEXT, visits INT, unique_visitors INT)
LANGUAGE plpgsql
AS $$
DECLARE
  dc TEXT := '';
BEGIN
  -- Report on Eastern Time: cast/compare day boundaries in America/New_York
  -- (CURRENT_DATE, NOW() and ::date all honour this session setting).
  SET LOCAL TimeZone = 'America/New_York';
  IF start_date <> '' AND end_date <> '' THEN
    dc := format('AND created_at::date BETWEEN %L AND %L', start_date, end_date);
  ELSIF days_back = 1 THEN
    dc := 'AND created_at::date = CURRENT_DATE';
  ELSIF days_back > 1 THEN
    dc := format('AND created_at >= NOW() - INTERVAL ''%s days''', days_back);
  END IF;

  RETURN QUERY EXECUTE format('
    SELECT
      CASE WHEN referrer = '''' OR referrer IS NULL THEN ''Direct'' ELSE referrer END AS source,
      COUNT(*)::int                   AS visits,
      COUNT(DISTINCT visitor_id)::int AS unique_visitors
    FROM page_views
    WHERE 1=1 %s
    GROUP BY source
    ORDER BY visits DESC
    LIMIT 20
  ', dc);
END;
$$;


-- Conversion funnel: landing-page views vs checkout-page views.
-- Checkout pages are detected by 'samcart' appearing in the page URL.
DROP FUNCTION IF EXISTS analytics_funnel(INT, TEXT, TEXT);
CREATE FUNCTION analytics_funnel(days_back INT DEFAULT 0, start_date TEXT DEFAULT '', end_date TEXT DEFAULT '')
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  dc TEXT := '';
  result JSON;
BEGIN
  -- Report on Eastern Time: cast/compare day boundaries in America/New_York
  -- (CURRENT_DATE, NOW() and ::date all honour this session setting).
  SET LOCAL TimeZone = 'America/New_York';
  IF start_date <> '' AND end_date <> '' THEN
    dc := format('AND created_at::date BETWEEN %L AND %L', start_date, end_date);
  ELSIF days_back = 1 THEN
    dc := 'AND created_at::date = CURRENT_DATE';
  ELSIF days_back > 1 THEN
    dc := format('AND created_at >= NOW() - INTERVAL ''%s days''', days_back);
  END IF;

  -- Landing = non-samcart hosts, excluding /complete/<id> confirmation pages
  EXECUTE format('
    SELECT json_build_object(
      ''landingViews'',   (SELECT COUNT(*)::int               FROM page_views WHERE page_url NOT ILIKE ''%%samcart%%'' AND page_path NOT LIKE ''/complete/%%'' %1$s),
      ''landingUnique'',  (SELECT COUNT(DISTINCT visitor_id)::int FROM page_views WHERE page_url NOT ILIKE ''%%samcart%%'' AND page_path NOT LIKE ''/complete/%%'' %1$s),
      ''checkoutViews'',  (SELECT COUNT(*)::int               FROM page_views WHERE page_url ILIKE ''%%samcart%%'' %1$s),
      ''checkoutUnique'', (SELECT COUNT(DISTINCT visitor_id)::int FROM page_views WHERE page_url ILIKE ''%%samcart%%'' %1$s)
    )', dc)
  INTO result;

  RETURN result;
END;
$$;
