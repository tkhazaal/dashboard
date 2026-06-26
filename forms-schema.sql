-- ============================================================
-- Form Submissions + Webhooks — run ONCE in Supabase → SQL Editor
-- Safe to re-run (CREATE ... IF NOT EXISTS).
-- ============================================================

-- A webhook the user creates in the dashboard. External software POSTs form
-- submissions to  <site>/hook/<token>  and we capture them here.
CREATE TABLE IF NOT EXISTS webhooks (
  id            BIGSERIAL    PRIMARY KEY,
  token         TEXT         UNIQUE NOT NULL,
  name          TEXT,
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  last_fired_at TIMESTAMPTZ
);

-- Every captured submission. payload = the raw JSON the software sent;
-- fields = a normalised [{q, a}] list for nice display.
CREATE TABLE IF NOT EXISTS form_submissions (
  id            BIGSERIAL    PRIMARY KEY,
  webhook_id    BIGINT,
  form_key      TEXT,
  contact_name  TEXT,
  contact_email TEXT,
  payload       JSONB        NOT NULL,
  fields        JSONB,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- Optional per-form display name (the user can rename a form in the dashboard).
CREATE TABLE IF NOT EXISTS forms (
  form_key   TEXT         PRIMARY KEY,
  name       TEXT,
  updated_at TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fs_email   ON form_submissions (lower(contact_email));
CREATE INDEX IF NOT EXISTS idx_fs_name    ON form_submissions (lower(contact_name));
CREATE INDEX IF NOT EXISTS idx_fs_formkey ON form_submissions (form_key);
CREATE INDEX IF NOT EXISTS idx_fs_webhook ON form_submissions (webhook_id);
CREATE INDEX IF NOT EXISTS idx_fs_created ON form_submissions (created_at DESC);
