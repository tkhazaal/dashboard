-- ============================================================
-- ManyChat optins / CTA tracking — run once in Supabase → SQL Editor
-- ============================================================

create table if not exists manychat_optins (
  id            bigserial primary key,
  ref               text,                   -- optional CTA tag (grouping)
  post_url          text,                   -- the FB/IG post or reel link → auto-matched to a post
  growth_tool_id    text,                   -- ManyChat last_growth_tool.id  (each comment-trigger = one post)
  growth_tool_name  text,                   -- ManyChat last_growth_tool.name
  event             text default 'optin',   -- 'optin' | 'cta_click'
  subscriber_id text,                       -- ManyChat user id (for de-dup / counting people)
  name          text,
  channel       text,                       -- instagram | facebook | messenger
  raw           jsonb,                      -- full webhook payload (debugging)
  created_at    timestamptz default now()
);
create index if not exists manychat_optins_ref_idx     on manychat_optins (ref);
create index if not exists manychat_optins_created_idx  on manychat_optins (created_at desc);

-- Link a Social Report post to a ManyChat ref so its optins show on that post.
alter table social_posts add column if not exists manychat_ref text;
