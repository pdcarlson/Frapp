create or replace function get_points_report(
  p_chapter_id uuid,
  p_user_id uuid default null,
  p_window text default null
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
    group by user_id, category
  ) pt on pt.user_id = u.id
  group by u.id, u.display_name;
end;
$$;
