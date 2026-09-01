-- #377: a semester archive picker needs a bounded range, not just an exclusive
-- lower bound. `p_since` alone can express "since the latest archive" (today's
-- semester/month windows) but not "this specific archived period", which also
-- has an upper bound (the archive's own end_date day). Add `p_until` as an
-- inclusive-day upper bound, resolved by the API the same way `p_since` is
-- (points-window.ts / the new semester-archive lookup), so leaderboard and
-- report totals keep agreeing for the same requested range.
--
-- New overload (parameter list changes), so drop the old signature first —
-- same pattern 20260604140000 used when it added `p_since`.
drop function if exists get_points_report(uuid, uuid, timestamptz);

create or replace function get_points_report(
  p_chapter_id uuid,
  p_user_id uuid default null,
  p_since timestamptz default null,
  p_until timestamptz default null
)
returns table (
  member_name text,
  total_points bigint,
  breakdown_by_category jsonb
)
language plpgsql
security invoker
as $$
begin
  return query
  select
    u.display_name as member_name,
    coalesce(sum(pt.category_amount), 0)::bigint as total_points,
    coalesce(jsonb_object_agg(
      coalesce(pt.category, 'OTHER'),
      pt.category_amount
    ), '{}'::jsonb) as breakdown_by_category
  from users u
  join (
    select
      user_id,
      category,
      sum(amount) as category_amount
    from point_transactions
    where chapter_id = p_chapter_id
      and (p_user_id is null or user_id = p_user_id)
      and (p_since is null or created_at > p_since)
      and (p_until is null or created_at <= p_until)
    group by user_id, category
  ) pt on pt.user_id = u.id
  group by u.id, u.display_name;
end;
$$;

-- `drop function` above dropped the old signature's grants along with it, and
-- a newly created function defaults to Postgres's EXECUTE-to-PUBLIC grant —
-- re-apply 20260901173000's lock-down (revoke public/anon/authenticated,
-- grant service_role only) to the new 4-arg signature so this doesn't
-- regress the convention that migration closed.
revoke execute on function get_points_report(uuid, uuid, timestamptz, timestamptz) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function get_points_report(uuid, uuid, timestamptz, timestamptz) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function get_points_report(uuid, uuid, timestamptz, timestamptz) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function get_points_report(uuid, uuid, timestamptz, timestamptz) to service_role;
  end if;
end
$$;
