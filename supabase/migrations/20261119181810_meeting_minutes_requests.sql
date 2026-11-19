-- A member asks for minutes that haven't been posted (#5471,
-- `spec/behavior/meetings.md` § Asking for minutes).
--
-- WHAT CHANGES
--
-- 1. `meeting_minutes_requests`: one row per member who asked for one
--    meeting's unposted minutes. The primary key is the first half of the
--    spam guard: a member asks once per meeting.
--
--      announced_at  when a reminder first counted this ask; null while the
--                    guard holds it back, so the next reminder counts only
--                    the members who asked since the last one ("Shawn and 2
--                    others asked").
--
-- 2. `meeting_minutes_request_pings`: one row per meeting, the time of its
--    last reminder: the second half of the guard, at most one reminder per
--    meeting per cooldown. Kept apart from the asks so that deleting the
--    account of the member whose ask sent it doesn't reset the cooldown.
--
--    Both tables have RLS on and no policies: the API reads and writes them
--    with the service role.
--
-- 3. `request_meeting_minutes(meeting, chapter, user, cooldown_seconds)`
--    records the ask and decides whether it sends a reminder. It locks the
--    meeting's row first, so two members asking at the same moment can't
--    both see "no reminder yet" and both send one. Returns one row:
--
--      requested  false when this member had already asked, or the minutes
--                 are posted or gone; nothing changed.
--      ping       true when the caller sends the reminder now.
--      asked      how many members the reminder speaks for (the caller and
--                 everyone held back since the last one); 0 without one.
--
-- 4. `release_meeting_minutes_ping(meeting, chapter, user)` undoes a reminder
--    the API could not send: it takes back the caller's ask, un-counts the
--    asks that reminder spoke for, and clears the cooldown, so the member
--    can ask again and a lost reminder never silences the meeting for a day.
--
--    Both functions are `security invoker`, like `add_private_channel_member`:
--    the API calls them with the service-role client, and EXECUTE is locked
--    to service_role.
--
-- 5. Posting the minutes removes their asks and their cooldown (an ask is
--    only about unposted minutes), and a deleted account removes its own
--    asks (`spec/behavior/data-retention.md`).
--
-- Locks. The foreign keys and the triggers take SHARE ROW EXCLUSIVE on
-- `meetings`, `chapters` and `users` until commit; nothing is rewritten.

-- 1. ------------------------------------------------------------------------

create table if not exists public.meeting_minutes_requests (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  announced_at timestamptz,
  primary key (meeting_id, user_id)
);

alter table public.meeting_minutes_requests enable row level security;

create index if not exists idx_meeting_minutes_requests_user
  on public.meeting_minutes_requests (user_id);
create index if not exists idx_meeting_minutes_requests_chapter
  on public.meeting_minutes_requests (chapter_id);

comment on table public.meeting_minutes_requests is
  'Members who asked for a meeting''s unposted minutes. Gone once they are posted. See 20261119181810_meeting_minutes_requests.sql.';

-- 2. ------------------------------------------------------------------------

create table if not exists public.meeting_minutes_request_pings (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  pinged_at timestamptz not null
);

alter table public.meeting_minutes_request_pings enable row level security;

create index if not exists idx_meeting_minutes_request_pings_chapter
  on public.meeting_minutes_request_pings (chapter_id);

comment on table public.meeting_minutes_request_pings is
  'When each meeting''s unposted minutes were last asked for with a reminder; at most one a day. See 20261119181810_meeting_minutes_requests.sql.';

-- 3. ------------------------------------------------------------------------

create or replace function public.request_meeting_minutes(
  p_meeting_id uuid,
  p_chapter_id uuid,
  p_user_id uuid,
  p_cooldown_seconds integer
)
returns table (requested boolean, ping boolean, asked integer)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  inserted integer;
  waiting integer;
  at timestamptz := now();
begin
  -- Serialises asks for one meeting; posted or deleted minutes ask nobody.
  perform 1
     from meetings
    where id = p_meeting_id
      and chapter_id = p_chapter_id
      and status = 'draft'
      for update;
  if not found then
    return query select false, false, 0;
    return;
  end if;

  insert into meeting_minutes_requests (meeting_id, chapter_id, user_id)
  values (p_meeting_id, p_chapter_id, p_user_id)
  on conflict (meeting_id, user_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    return query select false, false, 0;
    return;
  end if;

  if exists (
    select 1
      from meeting_minutes_request_pings
     where meeting_id = p_meeting_id
       and pinged_at > at - make_interval(secs => p_cooldown_seconds)
  ) then
    return query select true, false, 0;
    return;
  end if;

  update meeting_minutes_requests
     set announced_at = at
   where meeting_id = p_meeting_id
     and announced_at is null;
  get diagnostics waiting = row_count;

  insert into meeting_minutes_request_pings (meeting_id, chapter_id, pinged_at)
  values (p_meeting_id, p_chapter_id, at)
  on conflict (meeting_id) do update set pinged_at = excluded.pinged_at;

  return query select true, true, waiting;
end;
$$;

revoke execute on function public.request_meeting_minutes(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.request_meeting_minutes(uuid, uuid, uuid, integer)
  to service_role;

-- 4. ------------------------------------------------------------------------

create or replace function public.release_meeting_minutes_ping(
  p_meeting_id uuid,
  p_chapter_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  sent timestamptz;
begin
  perform 1 from meetings
    where id = p_meeting_id and chapter_id = p_chapter_id
    for update;
  delete from meeting_minutes_request_pings
   where meeting_id = p_meeting_id and chapter_id = p_chapter_id
  returning pinged_at into sent;
  if sent is not null then
    update meeting_minutes_requests
       set announced_at = null
     where meeting_id = p_meeting_id
       and chapter_id = p_chapter_id
       and announced_at = sent;
  end if;
  delete from meeting_minutes_requests
   where meeting_id = p_meeting_id
     and chapter_id = p_chapter_id
     and user_id = p_user_id;
end;
$$;

revoke execute on function public.release_meeting_minutes_ping(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_meeting_minutes_ping(uuid, uuid, uuid)
  to service_role;

-- 5. ------------------------------------------------------------------------

create or replace function public.meeting_minutes_requests_drop_on_post()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.meeting_minutes_requests where meeting_id = new.id;
  delete from public.meeting_minutes_request_pings where meeting_id = new.id;
  return new;
end;
$$;

revoke execute on function public.meeting_minutes_requests_drop_on_post()
  from public, anon, authenticated;

drop trigger if exists meetings_drop_minutes_requests_on_post on public.meetings;
create trigger meetings_drop_minutes_requests_on_post
  after update of status on public.meetings
  for each row
  when (new.status = 'posted' and old.status is distinct from 'posted')
  execute function public.meeting_minutes_requests_drop_on_post();

create or replace function public.meeting_minutes_requests_drop_for_deleted_user()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.meeting_minutes_requests where user_id = new.id;
  return new;
end;
$$;

revoke execute on function public.meeting_minutes_requests_drop_for_deleted_user()
  from public, anon, authenticated;

drop trigger if exists users_drop_meeting_minutes_requests on public.users;
create trigger users_drop_meeting_minutes_requests
  after update of deleted_at on public.users
  for each row
  when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.meeting_minutes_requests_drop_for_deleted_user();
