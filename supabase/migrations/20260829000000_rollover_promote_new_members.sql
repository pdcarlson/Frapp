-- Atomic semester rollover with optional New Member -> Member promotion (#285).
--
-- spec/behavior/semester-rollover.md step 3 has always specified that a rollover
-- offers to bulk-transition New Members to Members ("Admins are prompted with an
-- option to bulk-transition members from the 'New Member' role to the 'Member'
-- role"). Nothing implemented it: RolloverDto carried three fields and
-- SemesterRolloverService did a single archive insert.
--
-- The promotion cannot be two independent writes. `SemesterRolloverService`
-- reaches Postgres through the Supabase REST client, which has no cross-statement
-- transaction, so an archive insert followed by a separate bulk role UPDATE can
-- fail in between and leave the chapter archived-but-not-promoted -- with the
-- once-per-calendar-month guard now blocking the retry that would fix it. That is
-- the same failure shape 20260604120000_add_transfer_presidency_rpc.sql was written
-- for, and this function is its sibling: both writes run inside the single implicit
-- transaction of one plpgsql call, so either the semester rolled over and the
-- pledges were promoted, or neither happened.
--
-- ROLE SEMANTICS -- the part that is easy to get wrong. `members.role_ids` is a
-- text[] (00000000000000_initial_schema.sql:48), not a scalar: a member holds many
-- roles at once. "Promotion" is therefore array surgery, never an assignment. A
-- New Member who is also Secretary keeps Secretary. Writing this as
-- `set role_ids = array[p_member_role_id]` would silently strip every other role in
-- the chapter, which is precisely what the issue's AC 3 guards against.
--
-- Append is conditional so a member already holding BOTH roles does not end up with
-- a duplicate Member entry -- matching the idempotent `array_append` guard in
-- transfer_presidency.
--
-- Callers resolve both role ids by `roles.system_key`, never by `roles.name`
-- (20260806220000_role_system_key.sql): a chapter that renamed "New Member" would
-- otherwise silently promote nobody. The API refuses the rollover when either key
-- is unresolvable rather than archiving with a silent no-op promotion.
--
-- `security invoker`, matching transfer_presidency and the other atomic RPCs: the
-- API always calls this through the service-role SUPABASE_CLIENT, which bypasses
-- RLS, and EXECUTE is locked to service_role below. It deliberately carries no
-- `set search_path` -- the pg_temp pinning in
-- 20260827190000_secdef_search_path_pg_temp.sql applies to `security definer`
-- functions, which run with the definer's privileges; an invoker function resolves
-- names with exactly the caller's own authority and gains nothing from it. That
-- migration left transfer_presidency alone for the same reason.
--
-- Additive: creates one function. No table, column, constraint, policy or row is
-- altered. The non-promoting rollover path does not use this function at all and is
-- unchanged.
--
-- Rollback: `drop function if exists rollover_semester(uuid, text, date, date, text, text);`
-- The API tolerates its absence only by not offering promotion; drop it together
-- with reverting the service. See docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md.

create or replace function rollover_semester(
  p_chapter_id uuid,
  p_label text,
  p_start_date date,
  p_end_date date,
  p_new_member_role_id text,
  p_member_role_id text
)
returns semester_archives
language plpgsql
security invoker
as $$
declare
  v_archive semester_archives;
begin
  -- Both ids are required. A null would make `= any(role_ids)` null for every row,
  -- matching nothing, so the promotion would silently do nothing while the archive
  -- still committed -- the exact silent no-op the API's system_key check prevents.
  -- Raising here makes the invariant hold even if a future caller skips that check.
  if p_new_member_role_id is null or p_member_role_id is null then
    raise exception 'rollover_semester: both role ids are required when promoting'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_new_member_role_id = p_member_role_id then
    raise exception 'rollover_semester: new-member and member role ids must differ'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into semester_archives (chapter_id, label, start_date, end_date)
  values (p_chapter_id, p_label, p_start_date, p_end_date)
  returning * into v_archive;

  -- Scoped to this chapter, and only rows that actually hold New Member. Members
  -- who never held it are untouched (AC 3), as are other chapters entirely.
  --
  -- `members` has a trg_members_updated_at trigger, so updated_at is bumped
  -- automatically -- the UPDATE deliberately does not set it, matching
  -- transfer_presidency.
  update members
     set role_ids = case
           when p_member_role_id = any(role_ids)
             then array_remove(role_ids, p_new_member_role_id)
           else array_append(
             array_remove(role_ids, p_new_member_role_id),
             p_member_role_id
           )
         end
   where chapter_id = p_chapter_id
     and p_new_member_role_id = any(role_ids);

  return v_archive;
end;
$$;

-- Lock EXECUTE to the service role the API uses. Postgres grants EXECUTE to PUBLIC
-- by default and Supabase additionally grants anon/authenticated, so all three must
-- be revoked. Roles are guarded on existence to keep the migration portable to bare
-- Postgres substrates (e.g. PGlite in CI), matching transfer_presidency.
revoke execute on function rollover_semester(uuid, text, date, date, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function rollover_semester(uuid, text, date, date, text, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function rollover_semester(uuid, text, date, date, text, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function rollover_semester(uuid, text, date, date, text, text) to service_role;
  end if;
end
$$;
