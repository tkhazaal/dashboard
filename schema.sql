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
  ('site_name',   'My Dashboard'),
  ('tracker_url', 'http://localhost:3000')
ON CONFLICT (key) DO NOTHING;


-- ── Analytics functions (called via RPC) ──────────────────

CREATE OR REPLACE FUNCTION analytics_overview(days_back INT DEFAULT 0)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  dc TEXT := '';
  result JSON;
BEGIN
  IF days_back = 1 THEN
    dc := 'AND created_at::date = CURRENT_DATE';
  ELSIF days_back > 1 THEN
    dc := format('AND created_at >= NOW() - INTERVAL ''%s days''', days_back);
  END IF;

  EXECUTE format('
    SELECT json_build_object(
      ''totalViews'',     (SELECT COUNT(*)::int               FROM page_views WHERE 1=1 %1$s),
      ''uniqueVisitors'', (SELECT COUNT(DISTINCT visitor_id)::int FROM page_views WHERE 1=1 %1$s),
      ''uniqueSessions'', (SELECT COUNT(DISTINCT session_id)::int FROM page_views WHERE 1=1 %1$s),
      ''todayViews'',     (SELECT COUNT(*)::int               FROM page_views WHERE created_at::date = CURRENT_DATE),
      ''todayUnique'',    (SELECT COUNT(DISTINCT visitor_id)::int FROM page_views WHERE created_at::date = CURRENT_DATE),
      ''weekViews'',      (SELECT COUNT(*)::int               FROM page_views WHERE created_at >= NOW() - INTERVAL ''7 days''),
      ''monthViews'',     (SELECT COUNT(*)::int               FROM page_views WHERE created_at >= NOW() - INTERVAL ''30 days'')
    )', dc)
  INTO result;

  RETURN result;
END;
$$;


CREATE OR REPLACE FUNCTION analytics_pages(days_back INT DEFAULT 0, search_term TEXT DEFAULT '')
RETURNS TABLE(
  page_path       TEXT,
  page_title      TEXT,
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
  IF days_back = 1 THEN
    dc := 'AND created_at::date = CURRENT_DATE';
  ELSIF days_back > 1 THEN
    dc := format('AND created_at >= NOW() - INTERVAL ''%s days''', days_back);
  END IF;

  IF search_term <> '' THEN
    sc := format('AND (pv.page_path ILIKE ''%%%s%%'' OR pv.page_title ILIKE ''%%%s%%'')', search_term, search_term);
  END IF;

  RETURN QUERY EXECUTE format('
    SELECT pv.page_path, pv.page_title,
      COUNT(*)::int                   AS total_views,
      COUNT(DISTINCT visitor_id)::int AS unique_visitors,
      COUNT(DISTINCT session_id)::int AS sessions,
      MAX(created_at)                 AS last_seen
    FROM page_views pv
    WHERE 1=1 %s %s
    GROUP BY pv.page_path, pv.page_title
    ORDER BY total_views DESC
    LIMIT 100
  ', dc, sc);
END;
$$;


CREATE OR REPLACE FUNCTION analytics_trend(days_back INT DEFAULT 30)
RETURNS TABLE(day DATE, views INT, unique_visitors INT)
LANGUAGE plpgsql
AS $$
DECLARE
  where_clause TEXT := '';
BEGIN
  IF days_back > 0 THEN
    where_clause := format('WHERE created_at >= NOW() - INTERVAL ''%s days''', days_back);
  END IF;

  RETURN QUERY EXECUTE format('
    SELECT
      created_at::date          AS day,
      COUNT(*)::int             AS views,
      COUNT(DISTINCT visitor_id)::int AS unique_visitors
    FROM page_views %s
    GROUP BY created_at::date
    ORDER BY day ASC
  ', where_clause);
END;
$$;


CREATE OR REPLACE FUNCTION analytics_recent(days_back INT DEFAULT 0, page_filter TEXT DEFAULT '')
RETURNS TABLE(page_path TEXT, page_title TEXT, referrer TEXT, ip_address TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
AS $$
DECLARE
  dc TEXT := '';
  pc TEXT := '';
BEGIN
  IF days_back = 1 THEN
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


CREATE OR REPLACE FUNCTION analytics_referrers(days_back INT DEFAULT 0)
RETURNS TABLE(source TEXT, visits INT, unique_visitors INT)
LANGUAGE plpgsql
AS $$
DECLARE
  dc TEXT := '';
BEGIN
  IF days_back = 1 THEN
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
