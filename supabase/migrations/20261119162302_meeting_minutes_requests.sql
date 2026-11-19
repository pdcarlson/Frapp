-- A member asks for minutes that haven't been posted (#5471,
-- `spec/behavior/meetings.md` § Asking for minutes).
--
-- WHAT CHANGES
--
-- 1. `meeting_minutes_requests`: one row per member who asked for one
--    meeting's unposted minutes. The primary key is the first half of the
--    spam guard: a member asks once per meeting. RLS on and no policies: the
--    API reads and writes with the service role.
--
--      pinged_at  set on the request that sent the ping; null on one the
--                 guard held back.
--      announced  whether a ping has named this request yet, so the next
--                 ping counts only the members who asked since the last one
--                 ("Shawn and 2 others asked").
--
-- 2. `request_meeting_minutes(meeting, chapter, user, cooldown_seconds)`
--    records the request and decides whether it pings, the second half of
--    the guard: at most one ping per meeting per cooldown. It locks the
--    meeting's row first, so two members asking at the same moment can't
--    both see "no ping yet" and both ping. Returns one row:
--
--      requested  false when this member had already asked, or the minutes
--                 are posted or gone; nothing changed.
--      ping       true when the caller sends the ping now.
--      asked      how many members the ping speaks for (the caller and
--                 everyone who asked since the last ping); 0 without a ping.
--
--    `security invoker`, like `add_private_channel_member`: the API calls it
--    with the service-role client, and EXECUTE is locked to service_role.
--
-- 3. Posting the minutes removes their requests (a request is only about
--    unposted minutes), and a deleted account removes its own.
--
-- Locks. The foreign keys and the triggers take SHARE ROW EXCLUSIVE on
-- `meetings`, `chapters` and `users` until commit; nothing is rewritten.

-- 1. ------------------------------------------------------------------------

create table if not exists public.meeting_minutes_requests (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  pinged_at timestamptz,
  announced boolean not null default false,
  primary key (meeting_id, user_id)
);

alter table public.meeting_minutes_requests enable row level security;

create index if not exists idx_meeting_minutes_requests_user
  on public.meeting_minutes_requests (user_id);
create index if not exists idx_meeting_minutes_requests_chapter
  on public.meeting_minutes_requests (chapter_id);

comment on table public.meeting_minutes_requests is
  'Members who asked for a meeting''s unposted minutes. Gone once they are posted. See 20261119162302_meeting_minutes_requests.sql.';

-- 2. ------------------------------------------------------------------------

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
begin
  -- Serialises requests for one meeting; a posted or deleted meeting asks
  -- nobody.
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
      from meeting_minutes_requests
     where meeting_id = p_meeting_id
       and pinged_at > now() - make_interval(secs => p_cooldown_seconds)
  ) then
    return query select true, false, 0;
    return;
  end if;

  select count(*)::integer into waiting
    from meeting_minutes_requests
   where meeting_id = p_meeting_id
     and not announced;

  update meeting_minutes_requests
     set announced = true,
         pinged_at = case when user_id = p_user_id then now() else pinged_at end
   where meeting_id = p_meeting_id
     and not announced;

  return query select true, true, waiting;
end;
$$;

revoke execute on function public.request_meeting_minutes(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.request_meeting_minutes(uuid, uuid, uuid, integer)
  to service_role;

-- 3. ------------------------------------------------------------------------

create or replace function public.meeting_minutes_requests_drop_on_post()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.meeting_minutes_requests where meeting_id = new.id;
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
