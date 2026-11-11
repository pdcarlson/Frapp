-- Reordering a chapter's role tiers (#4071 part 2, slice 3 of #4068).
--
-- `PUT /v1/role-tiers/order` sends every one of the chapter's tiers in their
-- new order. A tier's position is its rank (1 is highest), and nobody may move
-- a tier ranked at or above their own, so the API also sends the tiers the
-- caller cannot move (`p_fixed_ids`): the current top of the order down to
-- and including the caller's own tier, which the President leaves empty.
--
-- The function checks, with the chapter's tiers locked, that:
--
--   p_ids names each of the chapter's tiers exactly once, and
--   both the current order and the new one start with p_fixed_ids,
--
-- and raises `check_violation` (23514) otherwise, which the API answers as
-- 409: the tiers changed since the caller read them. Holding the lock across
-- the check and the write means another officer's reorder cannot slip between
-- them and leave a tier the caller may not move above the caller.
--
-- One UPDATE moves every tier: `role_tiers_chapter_position` is deferrable,
-- so two tiers trading places is checked when the statement ends. Positions
-- become 1 to n. No role's permissions change: rank is read from the order,
-- and the tier trigger fires only on a change to a tier's permissions.
--
-- Security invoker, like the pledge-class reorder: the API calls it with the
-- service role. Not an RPC for anyone else.

create or replace function public.reorder_role_tiers(
  p_chapter_id uuid,
  p_ids uuid[],
  p_fixed_ids uuid[]
)
returns setof public.role_tiers
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_current uuid[];
  v_fixed integer := coalesce(cardinality(p_fixed_ids), 0);
begin
  perform 1
     from public.role_tiers t
    where t.chapter_id = p_chapter_id
      for update;

  select coalesce(array_agg(t.id order by t.position), '{}'::uuid[])
    into v_current
    from public.role_tiers t
   where t.chapter_id = p_chapter_id;

  if p_ids is null
     or cardinality(p_ids) <> cardinality(v_current)
     or (select count(distinct x) from unnest(p_ids) as x) <> cardinality(v_current)
     or not (p_ids @> v_current)
  then
    raise exception 'reorder_role_tiers: the list must name each of the chapter''s tiers once'
      using errcode = 'check_violation';
  end if;

  if v_fixed > 0 and (
       v_current[1:v_fixed] is distinct from p_fixed_ids
       or p_ids[1:v_fixed] is distinct from p_fixed_ids
     )
  then
    raise exception 'reorder_role_tiers: the tiers above the caller moved'
      using errcode = 'check_violation';
  end if;

  return query
    update public.role_tiers t
       set position = o.ord::integer
      from unnest(p_ids) with ordinality as o(id, ord)
     where t.id = o.id
       and t.chapter_id = p_chapter_id
    returning t.*;
end;
$$;

comment on function public.reorder_role_tiers(uuid, uuid[], uuid[]) is
  'Sets each of a chapter''s tiers to its 1-based place in p_ids; refuses (check_violation) unless p_ids names every tier once and both orders start with p_fixed_ids (PUT /v1/role-tiers/order). See 20261112001000_reorder_role_tiers.sql.';

revoke execute on function public.reorder_role_tiers(uuid, uuid[], uuid[]) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.reorder_role_tiers(uuid, uuid[], uuid[]) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.reorder_role_tiers(uuid, uuid[], uuid[]) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.reorder_role_tiers(uuid, uuid[], uuid[]) to service_role;
  end if;
end
$$;
