-- Refunds page: manual "why did we refund" tags.
-- The refunds themselves are pulled live from the SamCart & Kajabi APIs (source,
-- product, amount, date, customer). Neither API exposes a refund REASON, so this
-- table stores the human-assigned reason per refund. Run once in Supabase SQL editor.

create table if not exists refund_reasons (
  refund_key text primary key,        -- 'samcart:<id>' or 'kajabi:<id>'
  source     text,
  reason     text,
  note       text,
  updated_at timestamptz default now()
);
