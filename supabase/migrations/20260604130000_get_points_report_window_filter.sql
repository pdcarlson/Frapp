-- FRA-31: get_points_report honors a resolved time window.
--
-- The window boundary (all | semester | month) is resolved in the API
-- (apps/api/src/domain/utils/points-window.ts) and passed as an exclusive lower
-- bound `p_since`, so points-report totals match the points leaderboard exactly
-- (one source of truth). The RPC just filters `created_at`; a null `p_since`
-- means all-time (back-compatible with the previous all-time-only behavior).
--
-- The parameter type changes (`text p_window` -> `timestamptz p_since`), which
-- creates a NEW overload rather than replacing the old one. Drop the old
-- signature first so PostgREST never sees an ambiguous get_points_report(uuid,
-- uuid, ...). On a fresh database the prior migration (20250226120000) creates
-- the text overload first, so this drop matches and is safe.
drop function if exists get_points_report(uuid, uuid, text);

create or replace function get_points_report(
  p_chapter_id uuid,
  p_user_id uuid default null,
  p_since timestamptz default null
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
    group by user_id, category
  ) pt on pt.user_id = u.id
  group by u.id, u.display_name;
end;
$$;
