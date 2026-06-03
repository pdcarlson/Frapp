-- Atomic event check-in + point award (FRA-62).
--
-- Previously `AttendanceService.checkIn` inserted the event_attendance row and
-- then inserted the ATTENDANCE point-ledger row in two separate writes, with
-- only a best-effort try/catch delete to undo attendance if the points write
-- failed, and a non-atomic duplicate read -- so a partial failure could award
-- points while leaving no attendance row (or vice versa), and two concurrent
-- check-ins could both pass the in-memory duplicate guard and double-insert.
--
-- This function performs both writes inside its single implicit transaction.
-- Unlike confirm_task_completion (FRA-100) / approve_service_entry (FRA-50),
-- check-in has no pre-existing row carrying a `points_awarded` flag to
-- compare-and-set: it is a fresh INSERT. The authoritative concurrency guard is
-- therefore the `unique (event_id, user_id)` constraint on event_attendance --
-- `on conflict do nothing` makes exactly one of N concurrent callers insert the
-- attendance row (and its ledger row); the rest insert zero rows, fall through
-- the `not found` branch, and return empty. Mirrors the "Atomic Point Awarding"
-- invariant in spec/behavior/points.md.
--
-- The point amount and event name are passed in as `p_point_value` /
-- `p_event_name` (the API already loaded the event), matching how
-- approve_service_entry takes `p_points`; this keeps the ledger row pinned to the
-- event the caller validated and avoids a second read of `events` here. A
-- 0-point event inserts attendance without a ledger row.
--
-- `security invoker` (matching the existing RPCs, e.g. confirm_task_completion /
-- approve_service_entry / get_points_report): the API always calls this via the
-- service-role SUPABASE_CLIENT, which bypasses RLS. If a caller is ever routed
-- through a user/anon client, the INSERTs into the RLS-protected
-- event_attendance / point_transactions would be denied -- switch to
-- `security definer` + `set search_path = public` first.

create or replace function check_in_event(
  p_event_id uuid,
  p_user_id uuid,
  p_chapter_id uuid,
  p_check_in_time timestamptz,
  p_point_value integer,
  p_event_name text
)
returns setof event_attendance
language plpgsql
security invoker
as $$
declare
  v_attendance event_attendance;
begin
  -- Insert the attendance row, guarded by the unique (event_id, user_id) index.
  -- On a concurrent/duplicate check-in the conflict fires, zero rows are
  -- inserted, and v_attendance is left unset (`not found`).
  insert into event_attendance (
    event_id, user_id, status, check_in_time, excuse_reason, marked_by
  )
  values (
    p_event_id, p_user_id, 'PRESENT', p_check_in_time, null, null
  )
  on conflict (event_id, user_id) do nothing
  returning * into v_attendance;

  -- No row inserted => already checked in (race lost / duplicate). Return empty
  -- so the service maps it to the existing 409 ConflictException.
  if not found then
    return;
  end if;

  -- Award the event's point value in the same transaction. The event name is
  -- passed in (the API already loaded the event), so the ledger row is pinned to
  -- the same event the caller validated -- no extra read of `events` here.
  if p_point_value <> 0 then
    insert into point_transactions (
      chapter_id, user_id, amount, category, description, metadata
    )
    values (
      p_chapter_id,
      p_user_id,
      p_point_value,
      'ATTENDANCE',
      'Attendance for event: ' || coalesce(p_event_name, ''),
      jsonb_build_object('event_id', p_event_id)
    );
  end if;

  return next v_attendance;
end;
$$;

-- This RPC writes to the point-ledger and the check-in eligibility / role-gate
-- checks live in the NestJS service + guard chain (not in table RLS). Lock
-- EXECUTE to the service role the API uses so it can't be called directly via
-- PostgREST by an `anon`/`authenticated` user, bypassing those checks. Postgres
-- grants EXECUTE to PUBLIC by default, and Supabase's default privileges
-- additionally grant it straight to anon/authenticated -- so all three must be
-- revoked, not just PUBLIC.
revoke execute on function check_in_event(uuid, uuid, uuid, timestamptz, integer, text) from public;

-- anon/authenticated/service_role are Supabase-managed roles, absent in bare
-- Postgres substrates (e.g. PGlite in CI), so guard each on role existence to
-- keep the migration portable.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function check_in_event(uuid, uuid, uuid, timestamptz, integer, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function check_in_event(uuid, uuid, uuid, timestamptz, integer, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function check_in_event(uuid, uuid, uuid, timestamptz, integer, text) to service_role;
  end if;
end
$$;
