-- Fold chapter_custom_roles into ordinary roles (#4075, child of #4068).
--
-- WHY
--
-- Frapp had two role systems: `roles` (what the guard reads, what the Roles
-- matrix and mobile edit, what tiers group) and `chapter_custom_roles` (label,
-- rank, capabilities), assigned through `members.custom_role_ids` and bridged
-- into the permission check by a second read in `PermissionsGuard`. Tiers
-- (20261111140000) would otherwise have had to be built twice. Paul decided on
-- 2026-11-10 to fold the second into the first and remove the Settings
-- surface that edited it.
--
-- WHAT THIS DOES
--
-- 1. Every `chapter_custom_roles` row becomes a `roles` row in the same
--    chapter, holding its capabilities without `*` (the guard never honoured a
--    custom role's wildcard, so dropping it changes nothing). The new row's id
--    is recorded in `chapter_custom_roles.folded_role_id`, and the time in
--    `folded_at`, which is what makes this file safe to run again: a row with
--    `folded_at` set is skipped, even when an officer has since deleted the
--    role it became (that clears `folded_role_id`, and must not bring the
--    role back).
--
--    The name is the label. When the chapter already has a role of that name
--    (`roles` is unique on chapter and name), the new role is called
--    "<label> (custom)", then "<label> (custom 2)" and so on, with the label
--    cut so the name stays within the API's 100-character cap. A custom role
--    never folds into an existing role, even one holding the same list:
--    events, mentions and the Members list key on role ids, so handing its
--    holders another role's id would change what they see.
--
--    It is placed in a tier the way 20261111140000 placed every role that was
--    not seeded, and not from `rank`: the only writer of `rank`, the web
--    Settings page, set it to creation order (1, 2, 3, ...), and the API
--    default was 99, so no rank says anything about a tier. So:
--      no permissions                                -> outside the tiers
--      a permission the chapter's Member role lacks  -> the tier at position 2
--      otherwise                                     -> the tier at position 3
--    and outside the tiers when the chapter has no tier at that position. The
--    role-sync trigger records the difference from the tier as overrides, so
--    the role's `permissions` is exactly the list it was given.
--
-- 2. Every member's `custom_role_ids` is rewritten into `role_ids`: each id
--    that names a custom role of the member's own chapter appends that role's
--    folded role (once, after the roles they already hold, so the first role,
--    which web's Members list shows, does not change). Ids that named a
--    deleted role or another chapter's role granted nothing and are dropped.
--    `custom_role_ids` is then emptied.
--
--    A member's effective permissions are therefore identical before and
--    after: the union of their roles' permissions plus their custom roles'
--    capabilities without `*`, both read within the chapter, was what the
--    guard computed, and every piece of it is now a role in `role_ids`. The
--    PGlite tier `scripts/pglite/tiers/fold-custom-roles.mjs` checks it member
--    by member.
--
-- 3. `transfer_presidency` stops reading `chapter_custom_roles`: after step 2
--    no member holds a custom role, so its second clause could only ever be
--    false, and the table it reads is going away.
--
-- WHAT THIS DOES NOT DO
--
-- The table and `members.custom_role_ids` stay for one release, so this can be
-- rolled back (`folded_role_id` says which role each custom role became) and so
-- a custom role written by an API still running the old code between this
-- migration and its deploy is folded by running this file again before the
-- drop (#4194). Nothing reads either for access after this.

alter table public.chapter_custom_roles
  add column if not exists folded_role_id uuid
    references public.roles(id) on delete set null,
  add column if not exists folded_at timestamptz;

comment on column public.chapter_custom_roles.folded_role_id is
  'The roles row this custom role became in 20261111210000_fold_custom_roles.sql (#4075). Null for a row written after that ran, or once that role is deleted.';
comment on column public.chapter_custom_roles.folded_at is
  'When 20261111210000_fold_custom_roles.sql (#4075) turned this row into a role. Null only for a row written after that ran; a re-run folds exactly those.';

do $$
declare
  v_custom record;
  v_permissions text[];
  v_member_permissions text[];
  v_role_id uuid;
  v_tier_id uuid;
  v_name text;
  v_base text;
  v_suffix integer;
  v_tag text;
  v_order integer;
begin
  for v_custom in
    select c.*
      from public.chapter_custom_roles c
     where c.folded_at is null
     order by c.chapter_id, c.rank, c.created_at, c.id
  loop
    select coalesce(array_agg(distinct p order by p), '{}'::text[])
      into v_permissions
      from unnest(v_custom.capabilities) as p
     where p is not null and p <> '*';

    v_base := coalesce(nullif(btrim(v_custom.label), ''), v_custom.key);

    -- A new role, under a name the chapter doesn't use yet.
    v_name := left(v_base, 100);
    v_suffix := 1;
    while exists (
      select 1 from public.roles r
       where r.chapter_id = v_custom.chapter_id and r.name = v_name
    ) loop
      v_tag := ' (custom' ||
        case when v_suffix = 1 then '' else ' ' || v_suffix end || ')';
      v_name := left(v_base, 100 - length(v_tag)) || v_tag;
      v_suffix := v_suffix + 1;
    end loop;

    select r.permissions into v_member_permissions
      from public.roles r
     where r.chapter_id = v_custom.chapter_id and r.system_key = 'MEMBER'
     limit 1;
    v_member_permissions := coalesce(v_member_permissions, '{}'::text[]);

    v_tier_id := null;
    if cardinality(v_permissions) > 0 then
      select t.id into v_tier_id
        from public.role_tiers t
       where t.chapter_id = v_custom.chapter_id
         and t.position = case
               when v_permissions <@ v_member_permissions then 3
               else 2
             end;
    end if;

    select coalesce(max(r.display_order), 0) + 1 into v_order
      from public.roles r
     where r.chapter_id = v_custom.chapter_id;

    insert into public.roles
      (chapter_id, name, permissions, is_system, system_key, display_order, tier_id)
    values
      (v_custom.chapter_id, v_name, v_permissions, false, null, v_order, v_tier_id)
    returning id into v_role_id;

    update public.chapter_custom_roles
       set folded_role_id = v_role_id,
           folded_at = now()
     where id = v_custom.id;
  end loop;
end
$$;

-- Each member's custom roles, as their folded roles, after the roles they hold.
-- Role ids are compared lower-cased, as the guard compares uuids.
update public.members m
   set role_ids = m.role_ids || coalesce((
         select array_agg(f.role_id order by f.first_at)
           from (
             select c.folded_role_id::text as role_id,
                    min(x.ord) as first_at
               from unnest(m.custom_role_ids) with ordinality as x(id, ord)
               join public.chapter_custom_roles c
                 on c.id = x.id
                and c.chapter_id = m.chapter_id
              where c.folded_role_id is not null
                -- coalesce: a NULL element would make `= any` NULL.
                and not coalesce(c.folded_role_id::text = any (
                  select lower(h) from unnest(m.role_ids) as h
                ), false)
              group by c.folded_role_id
           ) f
       ), '{}'::text[]),
       custom_role_ids = '{}'::uuid[]
 where cardinality(m.custom_role_ids) > 0;

-- transfer_presidency as 20261108200000 left it, without the custom-role
-- clause. `create or replace` resets the function's settings, so
-- `search_path` is pinned again; EXECUTE grants survive a replace with the
-- same signature, so the service-role-only lock from 20260604120000 holds.
create or replace function public.transfer_presidency(
  p_chapter_id uuid,
  p_current_member_id uuid,
  p_target_member_id uuid,
  p_president_role_id text
)
returns setof members
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_current members;
  v_target  members;
  v_member_role_id text;
begin
  -- Reject a self-transfer: both UPDATEs would target the same row (strip then
  -- re-add the role), a meaningless no-op the row-count check would otherwise
  -- read as success. The API also rejects this earlier with a 400.
  if p_current_member_id = p_target_member_id then
    raise exception 'transfer_presidency: current and target member must differ'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Compare-and-set on the current President: only strip the role if this member
  -- is in the chapter and still holds it. Zero rows updated => race lost / not
  -- eligible => return empty (the service raises 403).
  update members
     set role_ids = array_remove(role_ids, p_president_role_id)
   where id = p_current_member_id
     and chapter_id = p_chapter_id
     and p_president_role_id = any(role_ids)
  returning * into v_current;

  if not found then
    return;
  end if;

  -- Keep the outgoing President's member access (#3670): a live role in this
  -- chapter carrying `members:view` or `*`.
  if not exists (
       select 1
         from roles r
        where r.chapter_id = p_chapter_id
          and r.id::text = any (
            select lower(x) from unnest(v_current.role_ids) as x
          )
          and r.permissions && array['members:view', '*']
     )
  then
    select r.id::text
      into v_member_role_id
      from roles r
     where r.chapter_id = p_chapter_id
       and r.system_key = 'MEMBER'
     limit 1;

    -- Skip it when they already hold Member: a chapter that took
    -- `members:view` off its Member role gets nothing back from a second copy
    -- of the id.
    if v_member_role_id is not null
       -- coalesce: a NULL element would make `= any` NULL, skipping the append.
       and not coalesce(v_member_role_id = any (
         select lower(x) from unnest(v_current.role_ids) as x
       ), false) then
      update members
         set role_ids = array_append(role_ids, v_member_role_id)
       where id = p_current_member_id
      returning * into v_current;
    end if;
  end if;

  -- Add the role to the target in the SAME transaction. Order-preserving and
  -- idempotent: append only when absent, matching the prior `[...new Set(...)]`.
  update members
     set role_ids = case
           when p_president_role_id = any(role_ids) then role_ids
           else array_append(role_ids, p_president_role_id)
         end
   where id = p_target_member_id
     and chapter_id = p_chapter_id
  returning * into v_target;

  if not found then
    -- Target gone from the chapter since the API validated it. RAISE so the whole
    -- function (including the current-President removal above) rolls back.
    raise exception 'transfer_presidency: target member % not found in chapter %',
      p_target_member_id, p_chapter_id
      using errcode = 'no_data_found';
  end if;

  return next v_current;
  return next v_target;
end;
$$;
