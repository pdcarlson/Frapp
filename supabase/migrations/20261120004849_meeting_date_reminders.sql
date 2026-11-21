-- "Remind me" on a date in posted minutes' Coming up (#5672 step 2,
-- `spec/behavior/meetings.md` § Reading minutes → Coming up, tracked).
--
-- WHAT CHANGES
--
-- 1. `meeting_date_reminders`: one row per member per Coming up date they
--    asked to be reminded about. A date has no id of its own (it is an item
--    in the minutes' `content.dates`), so a reminder names it by its day and
--    its words, as they read when it was set. If an officer corrects or
--    takes out that date afterwards, the sweep finds it gone and sends
--    nothing, so a push never quotes words the minutes no longer say.
--
--      remind_at  when the push goes out. Setting it again moves it.
--
--    The minute sweep claims a due row by deleting it, compare-and-delete on
--    `remind_at`, so two replicas never both push and a reminder moved in
--    between waits for its new time. Nothing is kept once it has fired: the
--    push and its inbox row are the record, as the chat reminder's Activity
--    row is for a message.
--
--    A table of its own rather than `chat_message_reminders`: that one is
--    keyed by a message, and a date is not one.
--
--    RLS on with no policies, like `chat_message_reminders`: the API is the
--    only reader and writer, through the service-role client, so no client
--    path could ever show who set a reminder on what.
--
-- 2. A deleted account removes its own reminders (trigger on
--    `users.deleted_at`, as `meeting_minutes_requests` does), and deleted
--    minutes, chapters and users remove theirs by the foreign keys.
--
-- Locks. The foreign keys and the trigger take SHARE ROW EXCLUSIVE on
-- `meetings`, `chapters` and `users` until commit; nothing is rewritten.

-- 1. ------------------------------------------------------------------------

create table if not exists public.meeting_date_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  -- The request's chapter, kept true by the service reading the minutes
  -- through a chapter-scoped lookup first.
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  -- The date's day and words, as the minutes said them when it was set.
  day date not null,
  text text not null check (char_length(text) between 1 and 1000),
  -- Keys the words without putting up to 1,000 characters in a btree.
  text_md5 text generated always as (md5(text)) stored,
  remind_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One reminder per member per date: setting it again moves the one there
  -- is. Its index also serves the minutes page's read, "my reminders on
  -- these minutes", by its leading (user_id, meeting_id).
  unique (user_id, meeting_id, day, text_md5)
);

alter table public.meeting_date_reminders enable row level security;

-- The sweep's read: what is due, oldest first.
create index if not exists idx_meeting_date_reminders_due
  on public.meeting_date_reminders (remind_at);

-- Cascades from meetings probe by meeting.
create index if not exists idx_meeting_date_reminders_meeting
  on public.meeting_date_reminders (meeting_id);

create index if not exists idx_meeting_date_reminders_chapter
  on public.meeting_date_reminders (chapter_id);

comment on table public.meeting_date_reminders is
  'A member''s private reminders on Coming up dates in minutes. Deleted when they fire. See 20261120004849_meeting_date_reminders.sql.';

-- 2. ------------------------------------------------------------------------

create or replace function public.meeting_date_reminders_drop_for_deleted_user()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.meeting_date_reminders where user_id = new.id;
  return new;
end;
$$;

revoke execute on function public.meeting_date_reminders_drop_for_deleted_user()
  from public, anon, authenticated;

drop trigger if exists users_drop_meeting_date_reminders on public.users;
create trigger users_drop_meeting_date_reminders
  after update of deleted_at on public.users
  for each row
  when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.meeting_date_reminders_drop_for_deleted_user();
