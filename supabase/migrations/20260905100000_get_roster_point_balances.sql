-- #567: the roster report summed point balances in Node. It paged
-- `point_transactions` under `REPORT_AGGREGATE_MAX_ROWS` (50,000) and reduced
-- the rows into a Map — so a chapter past that ceiling got a roster of the
-- right length carrying *wrong* balances, footnoted rather than fixed. The
-- ceiling was never a tuning knob; it was a correctness cliff with a note on
-- it.
--
-- `GROUP BY user_id` returns one row per member regardless of transaction
-- volume, so the cliff disappears rather than moving: the read is now bounded
-- by the roster, which the report already pages on its own terms.
--
-- WHY A NEW FUNCTION RATHER THAN REUSING `get_points_report`, which already
-- aggregates the same table: it returns `member_name` and no key at all
-- (#747). The roster keys balances by `user_id`, and display names are not
-- unique, so joining on the name is wrong exactly where #747 says it is.
-- Adding `user_id` to that function changes its return type, which
-- `create or replace` cannot do — it needs `drop function` + recreate against
-- the forward-fix deploy sequence in `docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md`
-- so the live points report is never missing mid-deploy. That is #747's own
-- migration with its own rollback story. This one is purely additive: a new
-- name, no drop, no deploy window, and #747 stays independently fixable.
--
-- No window parameters. The roster balance is the member's all-time total in
-- the chapter — `getRosterReport` takes no window and never filtered by date.
-- Adding `p_since`/`p_until` here would be inventing a capability no caller
-- asks for, on a function whose signature is then expensive to change.
--
-- KNOWN OVERLAP, RECORDED RATHER THAN HIDDEN. PR #1698 (issue #522) is open at
-- the time of writing and adds `get_points_leaderboard(uuid, timestamptz,
-- timestamptz)`, which with both bounds null computes the same per-member sum
-- this function does. Whichever lands second leaves the repo with two functions
-- answering one question, which the tech-debt protocol in `AGENTS.md` says to
-- collapse rather than accumulate.
--
-- It is NOT collapsed here because that would mean building on an unmerged
-- migration: #1698's signature is still reviewable and could change or close,
-- and depending on it would block this fix behind someone else's PR and pin a
-- merge order nothing enforces. So this ships standalone and correct, and the
-- collapse is tracked as its own follow-up once #1698 actually merges — at
-- which point the roster can call the leaderboard function with null bounds and
-- this one is dropped. Do not "fix" the duplication by reverting either PR.

create or replace function get_roster_point_balances(p_chapter_id uuid)
returns table (
  user_id uuid,
  total_points bigint
)
language plpgsql
stable
security invoker
as $$
begin
  -- Every reference to a `point_transactions` column is qualified with `pt`.
  -- The RETURNS TABLE columns above are plpgsql OUT variables in this scope,
  -- and `user_id` matches a real column on the table — an unqualified mention
  -- would raise `column reference "user_id" is ambiguous` at call time, not at
  -- create time, so this is a runtime failure that DDL review cannot see.
  return query
  select
    pt.user_id,
    coalesce(sum(pt.amount), 0)::bigint as total_points
  from point_transactions pt
  where pt.chapter_id = p_chapter_id
  group by pt.user_id;
end;
$$;

-- Same lock-down 20260901173000 established as the convention and
-- 20260902010001 re-applied: a newly created function carries Postgres's
-- default EXECUTE-to-PUBLIC grant, and the API reaches this through the
-- service role. Exposing it to `anon`/`authenticated` would hand out a
-- per-member points oracle for any chapter id.
revoke execute on function get_roster_point_balances(uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function get_roster_point_balances(uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function get_roster_point_balances(uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function get_roster_point_balances(uuid) to service_role;
  end if;
end
$$;
