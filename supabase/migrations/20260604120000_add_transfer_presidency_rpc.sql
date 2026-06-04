-- Atomic presidency transfer (FRA-39).
--
-- Previously `RbacService.transferPresidency` removed the President (wildcard `*`)
-- role from the current President and added it to the target member in TWO
-- independent `members` updates. A failure of the second write could leave the
-- chapter with ZERO Presidents (removed from current, never added to target) --
-- or, on a stale read interleaving with another role edit, two. President carries
-- the `*` permission, so this is an auth/security invariant. See
-- spec/behavior/rbac.md ("Presidency Transfer": "single atomic operation -- the
-- system never allows a chapter to have zero Presidents or two Presidents
-- simultaneously").
--
-- This function performs both array writes inside its single implicit
-- transaction. The current-President UPDATE is a compare-and-set: it only fires
-- when the row is still in the chapter AND still actually holds the role
-- (`p_president_role_id = any(role_ids)`), so a concurrent/stale transfer that
-- already moved the role updates zero rows, falls through `not found`, and
-- returns empty -- the API maps that to its 403 "only the current President".
-- A target that has vanished from the chapter raises, rolling the whole
-- transaction back so the removal above is undone (the atomicity guarantee).
--
-- members.role_ids is text[] (not uuid[]); the role id is passed as text.
-- members has a `trg_members_updated_at` trigger, so updated_at is bumped
-- automatically -- the UPDATEs deliberately do not set it.
--
-- `security invoker` matches the sibling atomic RPCs (check_in_event,
-- confirm_task_completion, approve_service_entry, get_points_report): the API
-- always calls this via the service-role SUPABASE_CLIENT, which bypasses RLS, and
-- EXECUTE is locked to service_role below so no anon/authenticated caller can
-- reach it.

create or replace function transfer_presidency(
  p_chapter_id uuid,
  p_current_member_id uuid,
  p_target_member_id uuid,
  p_president_role_id text
)
returns setof members
language plpgsql
security invoker
as $$
declare
  v_current members;
  v_target  members;
begin
  -- Reject a self-transfer: both UPDATEs would target the same row (strip then
  -- re-add the role), a meaningless no-op the row-count check would otherwise
  -- read as success. The API also rejects this earlier with a 400.
  if p_current_member_id = p_target_member_id then
    raise exception 'transfer_presidency: current and target member must differ'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Compare-and-set on the current President: only strip the role if this member
  -- is in the chapter and still holds it. Zero rows updated => race lost / not
  -- eligible => return empty (the service raises 403).
  update members
     set role_ids = array_remove(role_ids, p_president_role_id)
   where id = p_current_member_id
     and chapter_id = p_chapter_id
     and p_president_role_id = any(role_ids)
  returning * into v_current;

  if not found then
    return;
  end if;

  -- Add the role to the target in the SAME transaction. Order-preserving and
  -- idempotent: append only when absent, matching the prior `[...new Set(...)]`.
  update members
     set role_ids = case
           when p_president_role_id = any(role_ids) then role_ids
           else array_append(role_ids, p_president_role_id)
         end
   where id = p_target_member_id
     and chapter_id = p_chapter_id
  returning * into v_target;

  if not found then
    -- Target gone from the chapter since the API validated it. RAISE so the whole
    -- function (including the current-President removal above) rolls back.
    raise exception 'transfer_presidency: target member % not found in chapter %',
      p_target_member_id, p_chapter_id
      using errcode = 'no_data_found';
  end if;

  return next v_current;
  return next v_target;
end;
$$;

-- Lock EXECUTE to the service role the API uses; RbacService (via the service-role
-- SUPABASE_CLIENT) is the only legitimate caller. Postgres grants EXECUTE to
-- PUBLIC by default and Supabase additionally grants anon/authenticated, so all
-- three must be revoked. Roles are guarded on existence to keep the migration
-- portable to bare Postgres substrates (e.g. PGlite in CI).
revoke execute on function transfer_presidency(uuid, uuid, uuid, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function transfer_presidency(uuid, uuid, uuid, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function transfer_presidency(uuid, uuid, uuid, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function transfer_presidency(uuid, uuid, uuid, text) to service_role;
  end if;
end
$$;
