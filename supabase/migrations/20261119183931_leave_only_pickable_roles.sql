-- Members leave only roles marked pickable (asked by Paul, 2026-11-19, #5650).
--
-- self_assign_role (20261114171856, #4958) let a member take off any role
-- with no system_key outside the tiers, marked or not, so a role an officer
-- gave (a committee role placed outside the tiers) could be dropped by its
-- holder. Leaving now needs the role marked self-assignable, as joining does:
-- a role an officer gave, or one an officer has stopped offering, stays until
-- an officer takes it off. The constraint keeps a marked role safe, so this is
-- the same test for both directions. Joining still refuses an alum.
--
-- Everything else is unchanged: the locks (role, then member), the outcomes,
-- and the grants, re-stated so this file stands alone.

create or replace function public.self_assign_role(
  p_chapter_id uuid,
  p_member_id uuid,
  p_role_id uuid,
  p_join boolean
)
returns table (outcome text, role_ids text[])
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_role public.roles%rowtype;
  v_current text[];
  v_next text[];
begin
  select * into v_role
    from public.roles r
   where r.id = p_role_id
     and r.chapter_id = p_chapter_id
     for share;
  if not found
     or v_role.system_key is not null
     or v_role.tier_id is not null
     or not v_role.self_assignable then
    return query select 'not_assignable'::text, null::text[];
    return;
  end if;

  select m.role_ids into v_current
    from public.members m
   where m.id = p_member_id
     and m.chapter_id = p_chapter_id
     for update;
  if not found then
    return query select 'no_member'::text, null::text[];
    return;
  end if;

  if p_join and exists (
    select 1
      from unnest(coalesce(v_current, array[]::text[])) as x
      join public.roles a
        on a.id::text = lower(x)
       and a.chapter_id = p_chapter_id
       and a.system_key = 'ALUMNI'
  ) then
    return query select 'alumni'::text, null::text[];
    return;
  end if;

  v_current := coalesce(v_current, array[]::text[]);
  if p_join then
    -- Already held (in any letter case): nothing to write.
    if exists (
      select 1 from unnest(v_current) as x where lower(x) = p_role_id::text
    ) then
      v_next := v_current;
    else
      v_next := v_current || p_role_id::text;
    end if;
  else
    v_next := array(
      select x
        from unnest(v_current) with ordinality as t(x, n)
       where lower(x) <> p_role_id::text
       order by n
    );
  end if;

  if v_next is distinct from v_current then
    update public.members m
       set role_ids = v_next
     where m.id = p_member_id;
  end if;

  return query select 'ok'::text, v_next;
end;
$$;

comment on function public.self_assign_role(uuid, uuid, uuid, boolean) is
  'Adds (p_join, not to an alum) or removes a role marked self-assignable on a member, under locks ordered role then member as delete_role takes them (#4958; leaving needs the mark since #5650). See 20261114171856_self_assignable_roles.sql and 20261119183931_leave_only_pickable_roles.sql.';

revoke execute on function public.self_assign_role(uuid, uuid, uuid, boolean) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.self_assign_role(uuid, uuid, uuid, boolean) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.self_assign_role(uuid, uuid, uuid, boolean) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.self_assign_role(uuid, uuid, uuid, boolean) to service_role;
  end if;
end
$$;
