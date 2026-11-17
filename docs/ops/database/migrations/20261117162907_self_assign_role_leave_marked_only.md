# 20261117162907_self_assign_role_leave_marked_only.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

`self_assign_role` lets a member leave only a role marked self-assignable, as joining already required, so a role an officer gave outside the tiers stays until an officer takes it off ([rbac.md § Self-assignable roles](../../../../spec/behavior/rbac.md#self-assignable-roles)).

## Promotion

- **Purpose**: `self_assign_role(..., p_join => false)` answers `not_assignable` for an unmarked role instead of removing it. Joining is unchanged.
- **Checks**: `select pg_get_functiondef('public.self_assign_role(uuid, uuid, uuid, boolean)'::regprocedure) like '%or not v_role.self_assignable then%';` is true.
- **Promoter notes**: order against the API doesn't matter: the API that ships with it refuses the same leave first, and the older API answers this function's `not_assignable` with `409`. No data is written.

## Rollback

Worth reverting only with the API change it ships with. A forward migration restores the function as `20261114171856` wrote it
([playbook](../../db-rollback-playbook.md#decision-matrix)).

```sql
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
     or (p_join and not v_role.self_assignable) then
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
```
