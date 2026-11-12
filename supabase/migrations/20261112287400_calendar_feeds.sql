-- Calendar subscription links (#3322, step 1).
--
-- spec/behavior/events.md § Calendar subscription owns the rule. A member
-- gets one private link per chapter that Apple Calendar, Google Calendar and
-- Outlook subscribe to. The link serves the chapter's events the member can
-- see and their own open tasks, read fresh on every fetch, so a change in
-- Frapp reaches the calendar the next time it checks.
--
-- 1. `calendar_feeds`: one row per link. `token` is the secret in the URL, and
--    the URL is the whole credential (calendar apps send no sign-in), so it is
--    random, long and unique. A member has at most one live link per chapter
--    (the partial unique index). Resetting the link stamps `revoked_at` on the
--    old row and adds a new one; a revoked link keeps answering, with an empty
--    calendar, so a calendar still subscribed to it clears instead of keeping
--    the last events it saw. Keyed to the user and chapter, not the `members`
--    row, so leaving the chapter keeps the row and the link serves an empty
--    calendar for the same reason.
--    RLS on and no policies: API only (service role). The token is stored as
--    it is, like `invites.token`, because the member can open the menu and
--    copy their link again on another device; anyone who can read this table
--    can already read the events it would serve.
-- 2. A deleted account takes its links with it. A trigger on
--    `users.deleted_at`, which `anonymize_user` sets, as
--    `users_drop_meeting_recordings` is: `anonymize_user` is not redefined
--    here.
--
-- Locks. The table's two foreign keys add triggers to `users` and `chapters`,
-- taking SHARE ROW EXCLUSIVE on both until commit, and the new trigger on
-- `users` takes the same lock; writes to those tables (a sign-up, a profile
-- edit, a chapter switch) wait for the few catalog statements that follow.
-- No rows are touched. Safe to apply twice.

-- 1. ------------------------------------------------------------------------

create table if not exists public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  chapter_id uuid not null references chapters(id) on delete cascade,
  token text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint calendar_feeds_token_length check (char_length(token) >= 32)
);

create unique index if not exists calendar_feeds_token_key
  on public.calendar_feeds (token);

create unique index if not exists calendar_feeds_one_live_per_member
  on public.calendar_feeds (chapter_id, user_id)
  where revoked_at is null;

alter table public.calendar_feeds enable row level security;

-- 2. ------------------------------------------------------------------------

create or replace function public.calendar_feeds_drop_for_deleted_user()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.calendar_feeds where user_id = new.id;
  return new;
end;
$$;

revoke execute on function public.calendar_feeds_drop_for_deleted_user()
  from public, anon, authenticated;

drop trigger if exists users_drop_calendar_feeds on public.users;
create trigger users_drop_calendar_feeds
  after update of deleted_at on public.users
  for each row
  when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.calendar_feeds_drop_for_deleted_user();
