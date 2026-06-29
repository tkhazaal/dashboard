-- Social Report: posts/reels scraped from Facebook + Instagram via Apify, with
-- auto-updating metrics + manual annotation columns. Run once in Supabase SQL editor.
create table if not exists social_posts (
  post_id      text primary key,          -- 'fb_<id>' / 'ig_<id>' (merged across scrapers)
  platform     text,                       -- Facebook | Instagram
  content_type text,                       -- Post | Reel | Video
  url          text,
  posted_at    timestamptz,
  caption      text,
  thumbnail    text,
  -- metrics (auto-updated each sync)
  views        bigint default 0,
  likes        bigint default 0,
  comments     bigint default 0,
  shares       bigint default 0,
  -- manual annotations (preserved across syncs)
  post_num     text,
  hook_topic   text,
  offer        text,
  status       text,
  notes        text,
  first_seen   timestamptz default now(),
  last_updated timestamptz default now()
);
create index if not exists social_posts_posted_at_idx on social_posts (posted_at desc);
