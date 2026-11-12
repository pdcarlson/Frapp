-- Google Calendar connections (#3322, step 2).
--
-- spec/behavior/events.md § Google Calendar owns the rule. A member signs in
-- with Google once, and Frapp keeps a calendar of its own in their Google
-- account up to date with the chapter's events they can see and their open
-- tasks: the same items the subscription link (calendar_feeds) serves, written
-- through the Google Calendar API so an edit shows within minutes rather than
-- whenever Google next fetches a link.
--
-- 1. `google_calendar_connections`: one live row per member per chapter.
--    `refresh_token_sealed` is Google's refresh token, encrypted by the API
--    (AES-256-GCM under GOOGLE_CALENDAR_TOKEN_KEY, bound to the row's chapter
--    and user), so a database read alone never yields a usable credential.
--    `calendar_id` is the calendar Frapp made in the member's account. Status:
--    `active` syncs; `needs_reconnect` means Google refused the token (the
--    member revoked access, or changed their password) and nothing syncs until
--    they connect again; `disconnecting` means the member disconnected or the
--    account was deleted, and the API still has to remove Frapp's calendar and
--    revoke the token at Google. A disconnecting row is not live, so the member
--    can connect again at once (the partial unique index); its `sync_due_at`
--    is when the disconnect was asked for, and the API gives up on Google and
--    deletes the row three days after it.
--    RLS on and no policies: API only (service role).
-- 2. `google_calendar_oauth_states`: one row per started sign-in, single use,
--    ten minutes. It names the member who started it and where the browser
--    goes back to, so the finishing request can be checked against the member
--    making it. RLS on, no policies.
-- 3. `claim_google_calendar_syncs`: the connections the API's minute worker
--    takes next, each leased so that several API instances never sync the same
--    one at once. A claimed active row is next due in fifteen minutes, which
--    catches what no trigger sees (a role change, the calendar window moving
--    on).
-- 4. Triggers on `events` and `tasks`: any write makes the chapter's active
--    connections due now, so an edit reaches Google at the worker's next tick.
--    The update skips rows already due, so a series written in one statement
--    costs one row update per connection, not one per event.
-- 5. A deleted account's connections turn `disconnecting` (the API then
--    removes the calendar and revokes the token) and its sign-ins in flight go.
--    A trigger on `users.deleted_at`, which `anonymize_user` sets, as
--    `users_drop_calendar_feeds` is: `anonymize_user` is not redefined here.
--
-- Locks. The foreign keys add triggers to `users` and `chapters`, and the new
-- triggers on `events`, `tasks` and `users` take SHARE ROW EXCLUSIVE on each
-- until commit; writes to those tables wait for the few catalog statements
-- that follow. No rows are touched. Safe to apply twice.

-- 1. ------------------------------------------------------------------------

create table if not exists public.google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  google_email text,
  refresh_token_sealed text not null,
  calendar_id text,
  status text not null default 'active',
  sync_due_at timestamptz not null default now(),
  sync_lease_until timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  constraint google_calendar_connections_status_check
    check (status in ('active', 'needs_reconnect', 'disconnecting'))
);

create unique index if not exists google_calendar_connections_one_live_per_member
  on public.google_calendar_connections (chapter_id, user_id)
  where status <> 'disconnecting';

create index if not exists google_calendar_connections_due
  on public.google_calendar_connections (sync_due_at)
  where status <> 'needs_reconnect';

alter table public.google_calendar_connections enable row level security;

-- 2. ------------------------------------------------------------------------

create table if not exists public.google_calendar_oauth_states (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  return_to text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists google_calendar_oauth_states_expires
  on public.google_calendar_oauth_states (expires_at);

alter table public.google_calendar_oauth_states enable row level security;

-- 3. ------------------------------------------------------------------------

create or replace function public.claim_google_calendar_syncs(
  p_now timestamptz,
  p_limit integer,
  p_lease_seconds integer
)
returns setof public.google_calendar_connections
language sql
security invoker
set search_path = public, pg_temp
as $$
  with due as (
    select c.id
      from public.google_calendar_connections c
     where (c.sync_lease_until is null or c.sync_lease_until <= p_now)
       and ((c.status = 'active' and c.sync_due_at <= p_now)
            or c.status = 'disconnecting')
     order by c.sync_due_at
     limit greatest(p_limit, 0)
       for update skip locked
  )
  update public.google_calendar_connections c
     set sync_lease_until = p_now + make_interval(secs => p_lease_seconds),
         sync_due_at = case
           when c.status = 'active' then p_now + interval '15 minutes'
           else c.sync_due_at
         end
    from due
   where c.id = due.id
  returning c.*;
$$;

revoke execute on function public.claim_google_calendar_syncs(timestamptz, integer, integer)
  from public, anon, authenticated;

-- 4. ------------------------------------------------------------------------

create or replace function public.google_calendar_mark_chapter_due()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_chapter_id uuid;
begin
  if tg_op = 'DELETE' then
    v_chapter_id := old.chapter_id;
  else
    v_chapter_id := new.chapter_id;
  end if;
  update public.google_calendar_connections
     set sync_due_at = now()
   where chapter_id = v_chapter_id
     and status = 'active'
     and sync_due_at > now();
  return null;
end;
$$;

revoke execute on function public.google_calendar_mark_chapter_due()
  from public, anon, authenticated;

drop trigger if exists events_mark_google_calendar_due on public.events;
create trigger events_mark_google_calendar_due
  after insert or update or delete on public.events
  for each row
  execute function public.google_calendar_mark_chapter_due();

drop trigger if exists tasks_mark_google_calendar_due on public.tasks;
create trigger tasks_mark_google_calendar_due
  after insert or update or delete on public.tasks
  for each row
  execute function public.google_calendar_mark_chapter_due();

-- 5. ------------------------------------------------------------------------

create or replace function public.google_calendar_disconnect_deleted_user()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.google_calendar_connections
     set status = 'disconnecting',
         sync_due_at = now(),
         sync_lease_until = null
   where user_id = new.id
     and status <> 'disconnecting';
  delete from public.google_calendar_oauth_states where user_id = new.id;
  return new;
end;
$$;

revoke execute on function public.google_calendar_disconnect_deleted_user()
  from public, anon, authenticated;

drop trigger if exists users_disconnect_google_calendar on public.users;
create trigger users_disconnect_google_calendar
  after update of deleted_at on public.users
  for each row
  when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.google_calendar_disconnect_deleted_user();
