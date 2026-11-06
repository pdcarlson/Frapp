-- The chapter's default channel: where Chat opens for a member whose device
-- has no last channel (owner, 2026-11-06: officers pick it; members do not get
-- a pick of their own, because Chat already reopens their last channel).
--
--   is_default  true on at most one channel per chapter.
--
-- Not null with a constant default, so adding it rewrites no row (Postgres
-- 11+ stores the default in the catalog). Every chapter starts with no
-- default, which keeps today's landing: `#general`, else the first channel.
-- The API refuses it on a DM or group DM and moves it off the old channel
-- before setting a new one.

alter table public.chat_channels
  add column if not exists is_default boolean not null default false;

-- One default per chapter. Partial, so it holds one entry per chapter that
-- has set a default and nothing for the rest.
create unique index if not exists chat_channels_one_default_per_chapter
  on public.chat_channels (chapter_id)
  where is_default;
