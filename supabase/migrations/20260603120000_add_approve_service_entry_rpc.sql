-- Atomic service-hour approval + point award (FRA-50).
--
-- Previously `ServiceEntryService.approve` inserted the SERVICE point-ledger row
-- and updated the service entry in two separate writes, so a partial failure
-- could award points while leaving the entry PENDING (and retryable), and two
-- concurrent approvals could both pass the in-memory `points_awarded` guard and
-- double-insert the ledger row.
--
-- This function performs both writes inside its single implicit transaction.
-- The conditional UPDATE (`status = 'PENDING' and points_awarded = false`) is a
-- compare-and-set: only one of N concurrent callers flips the entry to APPROVED
-- and inserts the ledger row; the rest update zero rows (`not found`) and return
-- empty. Mirrors `confirm_task_completion` (FRA-100) and the "Atomic Point
-- Awarding" invariant in spec/behavior/points.md.
--
-- The point amount is computed by the API (the chapter-configurable
-- minutes-per-point rate lives in the service layer) and passed in as
-- `p_points`; 0 approves the entry without a ledger row.
--
-- `security invoker` (matching the existing RPCs, e.g. confirm_task_completion /
-- get_points_report): the API always calls this via the service-role
-- SUPABASE_CLIENT, which bypasses RLS. If a caller is ever routed through a
-- user/anon client, the INSERT into the RLS-protected point_transactions would
-- be denied — switch to `security definer` + `set search_path = public` first.

create or replace function approve_service_entry(
  p_entry_id uuid,
  p_chapter_id uuid,
  p_reviewer_id uuid,
  p_review_comment text,
  p_points integer
)
returns setof service_entries
language plpgsql
security invoker
as $$
declare
  v_entry service_entries;
begin
  -- Compare-and-set: approve only a still-PENDING, not-yet-awarded entry.
  update service_entries
     set status = 'APPROVED',
         reviewed_by = p_reviewer_id,
         review_comment = p_review_comment,
         points_awarded = (p_points > 0)
   where id = p_entry_id
     and chapter_id = p_chapter_id
     and status = 'PENDING'
     and points_awarded = false
  returning * into v_entry;

  -- No row updated => entry missing, not PENDING, or already awarded (race lost).
  if not found then
    return;
  end if;

  -- Insert the SERVICE point-ledger row in the same transaction when a reward
  -- applies (sub-rate durations approve with no points).
  if p_points > 0 then
    insert into point_transactions (
      chapter_id, user_id, amount, category, description, metadata
    )
    values (
      v_entry.chapter_id,
      v_entry.user_id,
      p_points,
      'SERVICE',
      'Service hours approved: ' || v_entry.description,
      jsonb_build_object('service_entry_id', v_entry.id)
    );
  end if;

  return next v_entry;
end;
$$;

-- This RPC writes to the point-ledger and the `service:approve` authorization
-- check lives in the NestJS guard chain (not in table RLS). Lock EXECUTE to the
-- service role the API uses so it can't be called directly via PostgREST by an
-- `anon`/`authenticated` user, bypassing the permission check. Postgres grants
-- EXECUTE to PUBLIC by default, and Supabase's default privileges additionally
-- grant it straight to anon/authenticated — so all three must be revoked, not
-- just PUBLIC.
revoke execute on function approve_service_entry(uuid, uuid, uuid, text, integer) from public;

-- anon/authenticated/service_role are Supabase-managed roles, absent in bare
-- Postgres substrates (e.g. PGlite in CI), so guard each on role existence to
-- keep the migration portable.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function approve_service_entry(uuid, uuid, uuid, text, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function approve_service_entry(uuid, uuid, uuid, text, integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function approve_service_entry(uuid, uuid, uuid, text, integer) to service_role;
  end if;
end
$$;
