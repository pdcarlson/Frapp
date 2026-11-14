-- Self-assignable roles (#4958): officers mark a role members may join and
-- leave themselves, the way Discord's onboarding questions and reaction-role
-- bots hand out interest roles. Nobody may pick their way into power, so a
-- role is pickable only while it is safe (spec/behavior/rbac.md
-- § Self-assignable roles):
--
--   * no `system_key`: never President, Everyone, New Member or Alumni, whose
--     lifecycle and claim-walk meaning rides on the key;
--   * outside the tiers (`tier_id` null): it ranks below every tier, so it is
--     never above Everyone, never a presidency claim-walk candidate
--     (`resolveEligibleClaimants` takes only roles ranked above Everyone), and
--     no tier edit or reorder can hand it a permission or lift it;
--   * no permission beyond seeing its channels: every entry of `permissions`
--     is a `channels:read:<slug>` key (what a Discord import gives its roles),
--     or there are none. What it opens is the channels whose who-can-see and
--     who-can-post lists name it.
--
-- `role_self_assignable_safe` is that rule. `@repo/validation`'s
-- `selfAssignableRefusal` is a second copy, for the API's 400 and the clients'
-- explanation; each is tested on its own against the same cases (the pglite
-- tier and `self-assignable-roles.spec.ts`), and nothing compares the two, so
-- change both together.
--
-- `roles_self_assignable_safe` is a check constraint, so a write that leaves a
-- marked role unsafe fails, whoever writes it, instead of landing. It is
-- checked after `trg_roles_sync_permissions` has rewritten `permissions` for
-- the new tier and overrides, so it judges the list the row will hold. The
-- API refuses such a save first (400) unless it also unmarks the role; the
-- constraint closes the race that check can't: a save that read the role
-- unmarked, landing after an officer marked it and members joined, fails
-- (the API answers 409) instead of handing those members a permission.
--
-- self_assign_role(p_chapter_id, p_member_id, p_role_id, p_join) adds the
-- role to the member's `role_ids` (p_join) or takes it off. In one
-- transaction it
--
--   share-locks the role, so a role save or `delete_role` (which locks it
--     `for update`) either commits first, and this sees the row it left, or
--     waits for this write;
--   locks the member row and adds or removes the id, compared lower-cased
--     as `delete_role` and the guard compare it.
--
-- Joining needs the role marked (the constraint keeps a marked role safe),
-- and is refused to a member holding the Alumni role: an event that lists a
-- role skips the alumni check-in rule for its holders, because listing it was
-- an officer's choice of who attends, and a role an alum picked for
-- themselves is not (spec/behavior/alumni.md).
--
-- Leaving needs only that the role has no `system_key` and sits outside the
-- tiers, marked or not, so a member who picked a role can drop it after an
-- officer unmarks it or gives it a permission. Leaving only takes from the
-- caller, and the tiers and keyed roles stay the officers' to take away.
--
-- Locks are taken role first, member second, the order `delete_role` and
-- `set_member_role_ids` take them, so none of the three can deadlock.
--
-- Everyone is left as it is. A pickable role grants nothing a member's access
-- rests on, so joining or leaving one can't change whether `rolesAfterSave`
-- would give or take Everyone.
--
-- It answers one row: `outcome` is 'ok' with the written `role_ids`,
-- 'not_assignable' (no such role in the chapter, or not one the member may
-- join or leave), 'alumni', or 'no_member'. Security invoker, called by the
-- API with the service role.

alter table public.roles
  add column self_assignable boolean not null default false;

comment on column public.roles.self_assignable is
  'Members may join and leave this role themselves (#4958). The roles_self_assignable_safe constraint holds it to role_self_assignable_safe.';

create or replace function public.role_self_assignable_safe(
  p_system_key text,
  p_tier_id uuid,
  p_permissions text[]
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_system_key is null
     and p_tier_id is null
     and not exists (
           select 1
             from unnest(coalesce(p_permissions, array[]::text[])) as p
            where p not like 'channels:read:_%'
         );
$$;

comment on function public.role_self_assignable_safe(text, uuid, text[]) is
  'Whether a role may be self-assignable (#4958): no system_key, outside the tiers, and no permission beyond channels:read:<slug>. Mirrors selfAssignableRefusal in @repo/validation.';

alter table public.roles
  add constraint roles_self_assignable_safe
  check (
    not self_assignable
    or public.role_self_assignable_safe(system_key, tier_id, permissions)
  );

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

comment on function public.self_assign_role(uuid, uuid, uuid, boolean) is
  'Adds (p_join, a marked role, not to an alum) or removes (a role with no system_key outside the tiers) a role on a member, under locks ordered role then member as delete_role takes them (#4958). See 20261114171856_self_assignable_roles.sql.';

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
