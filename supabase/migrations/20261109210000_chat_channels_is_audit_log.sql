-- `#chapter-audit` is system-write only (#3909): the audit mirror posts
-- there and no member does, whatever their permissions. Until now the API
-- found the channel by its name and gated it like any read-only channel, so
-- a holder of `*` or `announcements:post` could post in it, and a rename
-- would have cut the mirror off.
--
--   is_audit_log  true on the chapter's audit-log channel, at most one per
--                 chapter. The API refuses every member write in it, finds
--                 it by this flag rather than its name, and refuses turning
--                 its read-only switch off.
--
-- Not null with a constant default, so adding it rewrites no row.

alter table public.chat_channels
  add column if not exists is_audit_log boolean not null default false;

create unique index if not exists chat_channels_one_audit_log_per_chapter
  on public.chat_channels (chapter_id)
  where is_audit_log;

-- Backfill the seeded channel. Every chapter's `#chapter-audit` was created
-- by `ChapterService` as a PUBLIC channel with that name, and until this
-- migration the mirror found it only by that name, so the name is what marks
-- it. `distinct on` keeps the backfill inside the unique index even if a
-- chapter somehow holds two such rows (the oldest wins).
--
-- `is_read_only` is set back to true here as well: the spec has always made
-- this channel read-only, and an officer could have switched it off in Chat
-- settings before this change locked it.
update public.chat_channels c
set is_audit_log = true,
    is_read_only = true
from (
  select distinct on (chapter_id) id
  from public.chat_channels
  where name = 'chapter-audit'
    and type = 'PUBLIC'
  order by chapter_id, created_at, id
) audit
where c.id = audit.id;
