-- Leaving a role yourself needs the role marked self-assignable, as joining
-- does (spec/behavior/rbac.md § Self-assignable roles). Before this,
-- self_assign_role let a member take off any role with no system_key outside
-- the tiers, marked or not, which includes roles an officer gives: an event's
-- audience, a committee. Events that list such a role count its holders, so
-- taking it off stays an officer's change. A member still leaves any role
-- they could have picked, and an alum still leaves a marked role they hold.
--
-- Only the role check changes; the function is otherwise as
-- 20261114171856_self_assignable_roles.sql wrote it (locks, outcomes, grants).
-- `create or replace` keeps its grants. The API checks the same rule first
-- for the refusal's words (RbacService.setOwnSelfAssignableRole); this check,
-- under the role's share lock, is what answers a role unmarked mid-request
-- ('not_assignable', which the API turns into 409, reload).

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
  'Adds (p_join, not to an alum) or removes a marked self-assignable role on a member, under locks ordered role then member as delete_role takes them (#4958). See 20261114171856_self_assignable_roles.sql and 20261117162907_self_assign_role_leave_marked_only.sql.';
