-- Deleting a role takes it off its holders (#4547), and a tier reorder keeps
-- New members and Alumni at or below Everyone (#4548). Both from Paul's API
-- permission audit, 2026-11-12.
--
-- 1. delete_role(p_chapter_id, p_role_id)
--
-- `DELETE /v1/roles/:id` used to delete the role row and nothing else, so its
-- id stayed in `members.role_ids`. A member whose only live role it was then
-- got 403 on every route: removed from the chapter without `members:remove`
-- and without the rank rule for removal. In one transaction this function
--
--   locks the role and every member holding it,
--   takes the id out of each holder's `role_ids`,
--   gives the Everyone role (`system_key` MEMBER) to each holder left with no
--     role granting member access (`members:view` or `*`) and no New Member or
--     Alumni role, as `rolesAfterSave` (packages/validation/src/everyone-role.ts)
--     does for a save that leaves a member no access role, and
--   deletes the role,
--
-- and returns `{ role, stripped_member_ids, given_everyone_member_ids }` for
-- the audit row, or null when the chapter has no such role. Ids in
-- `role_ids` (text[]) are compared lower-cased, as the guard compares uuids
-- and 20261111210000 does, since a stored copy may be upper-case. A system role is
-- refused (`insufficient_privilege`, 42501); the API refuses it first.
--
-- 2. reorder_role_tiers gains a floor
--
-- spec/behavior/rbac.md § The Everyone role: Everyone stays in its tier so New
-- members can never claim the presidency, whose claim walk stops at that tier.
-- The reorder only protected the tiers above the caller, so a Vice President
-- could put the New members tier above the Everyone tier. Under the same tier
-- lock the function now refuses (`invalid_parameter_value`, 22023; the API
-- answers 400) an order that lifts a tier holding a NEW_MEMBER or ALUMNI keyed
-- role from at or below the Everyone role's tier to above it. A tier already
-- above it may stay or come down, so a chapter already in that state can
-- still reorder. A chapter whose Everyone role sits outside the tiers (the
-- legacy gap) has no floor to hold.
--
-- Security invoker, like the reorder: the API calls both with the service
-- role. Neither is an RPC for anyone else.

create or replace function public.delete_role(
  p_chapter_id uuid,
  p_role_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_role public.roles%rowtype;
  v_everyone uuid;
  v_stripped uuid[];
  v_given uuid[];
begin
  select * into v_role
    from public.roles r
   where r.id = p_role_id
     and r.chapter_id = p_chapter_id
     for update;
  if not found then
    return null;
  end if;
  if v_role.is_system then
    raise exception 'delete_role: system roles cannot be deleted'
      using errcode = 'insufficient_privilege';
  end if;

  perform 1
     from public.members m
    where m.chapter_id = p_chapter_id
      and exists (
        select 1 from unnest(m.role_ids) as x where lower(x) = p_role_id::text
      )
      for update;

  select r.id into v_everyone
    from public.roles r
   where r.chapter_id = p_chapter_id
     and r.system_key = 'MEMBER'
   limit 1;

  with holders as (
    select m.id,
           array(
             select x from unnest(m.role_ids) with ordinality as u(x, n)
              where lower(u.x) <> p_role_id::text
              order by u.n
           ) as remaining
      from public.members m
     where m.chapter_id = p_chapter_id
       and exists (
         select 1 from unnest(m.role_ids) as x where lower(x) = p_role_id::text
       )
  ),
  decided as (
    select h.id,
           h.remaining,
           v_everyone is not null
             and not exists (
               select 1 from unnest(h.remaining) as x where lower(x) = v_everyone::text
             )
             and not exists (
               select 1 from public.roles r
                where r.id::text in (select lower(x) from unnest(h.remaining) as x)
                  and r.chapter_id = p_chapter_id
                  and (
                    r.system_key in ('NEW_MEMBER', 'ALUMNI')
                    or r.permissions && array['members:view', '*']::text[]
                  )
             ) as give
      from holders h
  ),
  written as (
    update public.members m
       set role_ids = case when d.give then d.remaining || v_everyone::text
                           else d.remaining end
      from decided d
     where m.id = d.id
    returning m.id, d.give
  )
  select coalesce(array_agg(w.id order by w.id), '{}'::uuid[]),
         coalesce(array_agg(w.id order by w.id) filter (where w.give), '{}'::uuid[])
    into v_stripped, v_given
    from written w;

  delete from public.roles r where r.id = p_role_id;

  return jsonb_build_object(
    'role', to_jsonb(v_role),
    'stripped_member_ids', to_jsonb(v_stripped),
    'given_everyone_member_ids', to_jsonb(v_given)
  );
end;
$$;

comment on function public.delete_role(uuid, uuid) is
  'Deletes a non-system role, takes it off every holder and gives Everyone to a holder left with no member-access role, in one transaction (DELETE /v1/roles/:id, #4547). See 20261113164050_delete_role_and_tier_floor.sql.';

revoke execute on function public.delete_role(uuid, uuid) from public;

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
  v_everyone_at integer;
  v_everyone_was integer;
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

  -- The Everyone floor (#4548). Only a tier the order newly lifts above
  -- Everyone's is refused: a chapter already in that state (a reorder from
  -- before this, or a role moved before the API refused it) can still
  -- reorder, and every step that brings the tier down goes through. The
  -- keyed roles' rows are not locked: a role update locks its row before its
  -- tier trigger reads role_tiers, so locking them here could deadlock with
  -- it. A role moved in the gap is still never a claimant, since presidency's
  -- claim walk skips New Member and Alumni wherever they sit.
  select min(array_position(p_ids, r.tier_id)),
         min(array_position(v_current, r.tier_id))
    into v_everyone_at, v_everyone_was
    from public.roles r
   where r.chapter_id = p_chapter_id
     and r.system_key = 'MEMBER'
     and r.tier_id is not null;

  if v_everyone_at is not null and exists (
       select 1
         from public.roles r
        where r.chapter_id = p_chapter_id
          and r.system_key in ('NEW_MEMBER', 'ALUMNI')
          and r.tier_id is not null
          and array_position(p_ids, r.tier_id) < v_everyone_at
          and array_position(v_current, r.tier_id) >= v_everyone_was
     )
  then
    raise exception 'reorder_role_tiers: New members and Alumni stay at or below the Everyone tier'
      using errcode = 'invalid_parameter_value';
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
  'Sets each of a chapter''s tiers to its 1-based place in p_ids; refuses (check_violation) unless p_ids names every tier once and both orders start with p_fixed_ids, and (invalid_parameter_value) an order putting a New Member or Alumni tier above the Everyone tier (PUT /v1/role-tiers/order). See 20261112001000_reorder_role_tiers.sql and 20261113164050_delete_role_and_tier_floor.sql.';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.delete_role(uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.delete_role(uuid, uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.delete_role(uuid, uuid) to service_role;
  end if;
end
$$;

-- 3. Repair what earlier deletes left behind
--
-- `members.role_ids` is text[] and may hold an upper-case copy of an id, so
-- ids are compared lower-cased, as the guard compares uuids.
--
-- Before this, a deleted role's id stayed on its holders. Strip every id that
-- names no role of the member's chapter, and give Everyone to a member the
-- strip leaves with no member-access role, by the rule delete_role applies.
-- Only rows holding such an id are touched.
with stale as (
  select m.id,
         m.chapter_id,
         array(
           select x from unnest(m.role_ids) with ordinality as u(x, n)
            where exists (
              select 1 from public.roles r
               where r.id::text = lower(u.x) and r.chapter_id = m.chapter_id
            )
            order by u.n
         ) as remaining
    from public.members m
   where exists (
     select 1 from unnest(m.role_ids) as x
      where not exists (
        select 1 from public.roles r
         where r.id::text = lower(x) and r.chapter_id = m.chapter_id
      )
   )
),
decided as (
  select s.id,
         s.remaining,
         e.id as everyone,
         e.id is not null
           and not exists (
             select 1 from unnest(s.remaining) as x where lower(x) = e.id::text
           )
           and not exists (
             select 1 from public.roles r
              where r.id::text in (select lower(x) from unnest(s.remaining) as x)
                and (
                  r.system_key in ('NEW_MEMBER', 'ALUMNI')
                  or r.permissions && array['members:view', '*']::text[]
                )
           ) as give
    from stale s
    left join lateral (
      select r.id from public.roles r
       where r.chapter_id = s.chapter_id and r.system_key = 'MEMBER'
       limit 1
    ) e on true
)
update public.members m
   set role_ids = case when d.give then d.remaining || d.everyone::text
                       else d.remaining end
  from decided d
 where m.id = d.id;
