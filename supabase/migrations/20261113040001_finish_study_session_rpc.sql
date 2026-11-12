-- Atomic study-session finish + point award.
--
-- `StudyService` used to read the session, insert the STUDY point-ledger row,
-- then write the session back, as three separate calls with nothing tying the
-- award to the transition. Two requests that both read the session as ACTIVE
-- each awarded: a double-tapped Stop, or the app coming back to the
-- foreground and firing a heartbeat and a history read at the same
-- grace-expired session. Every other point award already happens inside one
-- transaction (`confirm_task_completion`, `approve_service_entry`,
-- `check_in_event`; the "Atomic Point Awarding" invariant in
-- spec/behavior/points.md); this brings study sessions in line.
--
-- The conditional UPDATE is a compare-and-set on the exact row the API
-- computed the finish from: still ACTIVE, and the same watermark
-- (`last_heartbeat_at`) and pause (`paused_at`). A concurrent heartbeat,
-- pause, resume or finish moves one of those, so this call updates zero rows
-- and returns empty, and the API recomputes from the fresh row. Only the
-- caller that wins inserts the ledger row, in the same transaction, so a
-- failed insert rolls the finish back and leaves the session ACTIVE and
-- retryable.
--
-- The point amount is computed by the API (the chapter's minutes-per-point
-- rate and the minimum length live in the service layer) and passed in as
-- `p_points`; 0 finishes the session without a ledger row.
--
-- The same file adds `idx_study_sessions_one_active`: one ACTIVE session per
-- member per chapter. Without it a double-tapped Start that passed the API's
-- "already active" check twice inserted two ACTIVE rows, after which every
-- study call failed reading "the" active session (`maybeSingle` refuses two
-- rows) and the member could never study again. Production had no such
-- duplicates when this was written (checked 2026-11-12), so the index builds.
--
-- `security invoker`, like the RPCs above: the API calls this through the
-- service-role client, which bypasses RLS.

create or replace function finish_study_session(
  p_session_id uuid,
  p_chapter_id uuid,
  p_expected_last_heartbeat_at timestamptz,
  p_expected_paused_at timestamptz,
  p_status text,
  p_end_time timestamptz,
  p_last_heartbeat_at timestamptz,
  p_total_foreground_minutes integer,
  p_points integer,
  p_description text
)
returns setof study_sessions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_session study_sessions;
begin
  -- Only the two statuses that award (spec/behavior/study-sessions.md
  -- § Points Award) finish through here.
  if p_status not in ('COMPLETED', 'PAUSED_EXPIRED') then
    raise exception 'finish_study_session: status % does not award', p_status
      using errcode = '22023';
  end if;

  update study_sessions
     set status = p_status,
         end_time = p_end_time,
         last_heartbeat_at = p_last_heartbeat_at,
         total_foreground_minutes = p_total_foreground_minutes,
         -- A completed session is no longer paused; a grace-expired one keeps
         -- the pause instant it ended at.
         paused_at = case when p_status = 'COMPLETED' then null else paused_at end,
         points_awarded = points_awarded or p_points > 0
   where id = p_session_id
     and chapter_id = p_chapter_id
     and status = 'ACTIVE'
     and last_heartbeat_at = p_expected_last_heartbeat_at
     and paused_at is not distinct from p_expected_paused_at
  returning * into v_session;

  if not found then
    return;
  end if;

  if p_points > 0 then
    insert into point_transactions (
      chapter_id, user_id, amount, category, description, metadata
    )
    values (
      v_session.chapter_id,
      v_session.user_id,
      p_points,
      'STUDY',
      p_description,
      jsonb_build_object(
        'study_session_id', v_session.id,
        'geofence_id', v_session.geofence_id,
        'total_minutes', p_total_foreground_minutes
      )
    );
  end if;

  return next v_session;
end;
$$;

-- The ledger write is authorized by the NestJS guard chain, not table RLS, so
-- only the service role may call this. Postgres grants EXECUTE to PUBLIC and
-- Supabase's default privileges grant it to anon/authenticated: revoke all
-- three. The role checks keep the migration portable to PGlite in CI.
revoke execute on function finish_study_session(uuid, uuid, timestamptz, timestamptz, text, timestamptz, timestamptz, integer, integer, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function finish_study_session(uuid, uuid, timestamptz, timestamptz, text, timestamptz, timestamptz, integer, integer, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function finish_study_session(uuid, uuid, timestamptz, timestamptz, text, timestamptz, timestamptz, integer, integer, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function finish_study_session(uuid, uuid, timestamptz, timestamptz, text, timestamptz, timestamptz, integer, integer, text) to service_role;
  end if;
end
$$;

create unique index if not exists idx_study_sessions_one_active
  on study_sessions (chapter_id, user_id)
  where status = 'ACTIVE';
