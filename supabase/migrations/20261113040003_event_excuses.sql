-- Absence excuses for required events (#3735).
--
-- WHAT CHANGES
--
-- `event_excuses` holds a member's request to be excused from an event that
-- requires them: one row per (event, member), with the one-line reason they
-- wrote and where it stands.
--
--   status      PENDING until someone decides, then APPROVED or DECLINED.
--   decided_by  who decided, and decided_at when (both null while PENDING).
--
-- It is kept apart from `event_attendance` so it can exist before the event:
-- an attendance row means "this is how they were counted", and a request sent
-- on Tuesday for Sunday's meeting is not that yet.
--
-- Two functions make each decision one transaction, so an excuse and the
-- attendance it implies can never disagree:
--
--   decide_event_excuse    PENDING to APPROVED writes attendance EXCUSED with
--                          the reason (over an ABSENT the sweep wrote, or a
--                          new row; never over a check-in or an officer's
--                          ABSENT). PENDING to DECLINED writes ABSENT only
--                          when the caller says the sweep has already passed
--                          the event (it skipped this member while the excuse
--                          was pending), and never over an existing row.
--   withdraw_event_excuse  Deletes a PENDING or APPROVED excuse; an APPROVED
--                          one also takes its EXCUSED attendance row with it,
--                          so the member can check in after all.
--
-- Each returns null when the excuse is no longer in a state it may act on
-- (decided or withdrawn concurrently), which the API maps to a 409.
--
-- RLS on with no policies, the posture of every chapter-owned table here: the
-- API reads and writes with the service role and enforces who may do what.

create table if not exists public.event_excuses (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  reason text not null,
  status text not null default 'PENDING',
  decided_by uuid references public.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_excuses_reason_len
    check (char_length(btrim(reason)) between 1 and 500),
  constraint event_excuses_status
    check (status in ('PENDING', 'APPROVED', 'DECLINED')),
  -- Decided means both who and when; pending means neither. decided_by alone
  -- may go null later, when the decider's user row is deleted.
  constraint event_excuses_decided
    check ((status = 'PENDING') = (decided_at is null)),
  constraint event_excuses_one_per_member unique (event_id, user_id)
);

-- The receiver's list for one event, and the sweep's pending lookup.
create index if not exists idx_event_excuses_event_status
  on public.event_excuses (event_id, status);

-- Chapter-scoped reads.
create index if not exists idx_event_excuses_chapter
  on public.event_excuses (chapter_id);

-- For the decided_by foreign key's set-null on user delete.
create index if not exists idx_event_excuses_decided_by
  on public.event_excuses (decided_by)
  where decided_by is not null;

alter table public.event_excuses enable row level security;

drop trigger if exists trg_event_excuses_updated_at on public.event_excuses;
create trigger trg_event_excuses_updated_at
  before update on public.event_excuses
  for each row execute function update_updated_at();

comment on table public.event_excuses is
  'A member''s request to be excused from an event that requires them, and its decision. Approving writes event_attendance EXCUSED (decide_event_excuse). See 20261113040003_event_excuses.sql.';

-- ── decide_event_excuse ──────────────────────────────────────────────────

create or replace function public.decide_event_excuse(
  p_excuse_id uuid,
  p_chapter_id uuid,
  p_decision text,
  p_decided_by uuid,
  p_mark_absent boolean
)
returns setof public.event_excuses
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_excuse public.event_excuses;
begin
  if p_decision not in ('APPROVED', 'DECLINED') then
    raise exception 'decision must be APPROVED or DECLINED'
      using errcode = '22023';
  end if;

  -- Compare-and-set on PENDING: a concurrent decision or withdrawal wins and
  -- this one returns no row.
  update public.event_excuses
     set status = p_decision,
         decided_by = p_decided_by,
         decided_at = now()
   where id = p_excuse_id
     and chapter_id = p_chapter_id
     and status = 'PENDING'
  returning * into v_excuse;

  if not found then
    return;
  end if;

  if p_decision = 'APPROVED' then
    -- Over the sweep's ABSENT (marked_by null: a late excuse) or an EXCUSED.
    -- Never over PRESENT or LATE, so a member who came anyway keeps their
    -- check-in, and never over an ABSENT an officer set: that was a decision
    -- about this member the excuse's receiver may not hold the permission to
    -- reverse. The API refuses both before calling (409); this is the guard.
    insert into public.event_attendance (event_id, user_id, status, excuse_reason, marked_by)
    values (v_excuse.event_id, v_excuse.user_id, 'EXCUSED', v_excuse.reason, p_decided_by)
    on conflict (event_id, user_id) do update
      set status = 'EXCUSED',
          excuse_reason = excluded.excuse_reason,
          marked_by = excluded.marked_by
      where public.event_attendance.status = 'EXCUSED'
         or (public.event_attendance.status = 'ABSENT'
             and public.event_attendance.marked_by is null);
  elsif p_mark_absent then
    -- The sweep already ran for this event and skipped the member while the
    -- excuse was pending: count them as it would have, recording who decided.
    insert into public.event_attendance (event_id, user_id, status, marked_by)
    values (v_excuse.event_id, v_excuse.user_id, 'ABSENT', p_decided_by)
    on conflict (event_id, user_id) do nothing;
  end if;

  return next v_excuse;
end;
$$;

-- ── withdraw_event_excuse ────────────────────────────────────────────────

create or replace function public.withdraw_event_excuse(
  p_event_id uuid,
  p_user_id uuid,
  p_chapter_id uuid
)
returns setof public.event_excuses
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_excuse public.event_excuses;
begin
  delete from public.event_excuses
   where event_id = p_event_id
     and user_id = p_user_id
     and chapter_id = p_chapter_id
     and status in ('PENDING', 'APPROVED')
  returning * into v_excuse;

  if not found then
    return;
  end if;

  if v_excuse.status = 'APPROVED' then
    -- Only the EXCUSED row the approval wrote; anything an officer changed
    -- it to since stays.
    delete from public.event_attendance
     where event_id = p_event_id
       and user_id = p_user_id
       and status = 'EXCUSED';
  end if;

  return next v_excuse;
end;
$$;

-- Only the service role (the API) may call these. Postgres grants EXECUTE to
-- PUBLIC and Supabase's default privileges grant it to anon/authenticated:
-- revoke all three, then grant the service role.
revoke execute on function public.decide_event_excuse(uuid, uuid, text, uuid, boolean) from public;
revoke execute on function public.withdraw_event_excuse(uuid, uuid, uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.decide_event_excuse(uuid, uuid, text, uuid, boolean) from anon;
    revoke execute on function public.withdraw_event_excuse(uuid, uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.decide_event_excuse(uuid, uuid, text, uuid, boolean) from authenticated;
    revoke execute on function public.withdraw_event_excuse(uuid, uuid, uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.decide_event_excuse(uuid, uuid, text, uuid, boolean) to service_role;
    grant execute on function public.withdraw_event_excuse(uuid, uuid, uuid) to service_role;
  end if;
end
$$;
