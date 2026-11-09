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
--
-- The backfill below covers the chapters that exist when this runs; the
-- trigger after it covers a `#chapter-audit` created later by an API that
-- doesn't set the flag (the older API in the gap between this migration and
-- its deploy, or after an API-only rollback).

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

-- A `#chapter-audit` seeded into a new chapter that has no audit log yet is
-- that chapter's audit log: flag it, and keep it read-only. Matches the
-- backfill's rule (a PUBLIC channel with the seeded name), so a chapter
-- created by any API version ends up the same.
--
-- Only while seeding, which is the onboarding request that creates the
-- chapter: the chapter is under an hour old. Later, a channel an officer or
-- a Discord import creates with that name stays an ordinary channel, so it
-- never turns into one nobody can post in, rename or delete, and an import
-- never writes member history into the audit log. A chapter that lost its
-- audit log before this migration (renamed or deleted) gets it back by hand.
create or replace function public.chat_channels_flag_audit_log()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.name = 'chapter-audit'
     and new.type = 'PUBLIC'
     and not new.is_audit_log
     and exists (
       select 1 from public.chapters
       where id = new.chapter_id
         and created_at > now() - interval '1 hour'
     )
     and not exists (
       select 1 from public.chat_channels
       where chapter_id = new.chapter_id and is_audit_log
     ) then
    new.is_audit_log := true;
    new.is_read_only := true;
  end if;
  return new;
end;
$$;

-- A trigger function is not an RPC (20261107160000): no client role keeps
-- EXECUTE on it.
revoke execute on function public.chat_channels_flag_audit_log()
  from public, anon, authenticated;

drop trigger if exists chat_channels_flag_audit_log on public.chat_channels;
create trigger chat_channels_flag_audit_log
  before insert on public.chat_channels
  for each row execute function public.chat_channels_flag_audit_log();
