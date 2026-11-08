-- The outgoing President keeps member access after a presidency transfer
-- (#3670, 2026-11-08).
--
-- `transfer_presidency` (20260604120000) strips the President role from the
-- outgoing President with `array_remove` and nothing else. A chapter's founder
-- is created holding President alone (`ChapterService.create`), so after a
-- transfer they held `{}` and `PermissionsGuard` refused them on every screen
-- ("No roles assigned"). A President who also held only a role without
-- `members:view` (a Discord-imported "Cabinet" carrying `channels:read:cabinet`)
-- was left with just that role: the same lockout the 2026-11-07 testers hit.
--
-- This redefinition keeps the signature, the compare-and-set and the rollback
-- of the original, and adds one step inside the same transaction: when the
-- outgoing member's remaining roles grant no member access, the chapter's
-- Member role is appended. "Member access" is read the way `PermissionsGuard`
-- reads it: a live role in this chapter carrying `members:view` or `*`, or a
-- custom role in this chapter whose capabilities carry `members:view` (the
-- guard drops `*` from custom roles). The seeded flag doesn't count on its
-- own, because a seeded role's permissions are editable. Member is appended,
-- not prepended: web's Members list labels a member by their first role.
-- A chapter with no Member role (`system_key` unset by the legacy backfill
-- gap) is left as before rather than failing the transfer; on 2026-11-08 no
-- production chapter lacked one. A member who already holds Member (a chapter
-- that took `members:view` off it) is not given a second copy.
--
-- No repair ships with this: on 2026-11-08 neither staging nor production had a
-- `presidency_transferred` audit row or a member without member access.
--
-- `create or replace` resets the function's settings, so `search_path` is
-- pinned again here the way 20261107160000 pinned every `public` function.
-- EXECUTE grants survive a `create or replace` with the same signature, so the
-- service-role-only lock from 20260604120000 still holds.

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

  -- Keep the outgoing President's member access (#3670).
  if not exists (
       select 1
         from roles r
        where r.chapter_id = p_chapter_id
          and r.id::text = any (
            select lower(x) from unnest(v_current.role_ids) as x
          )
          and r.permissions && array['members:view', '*']
     )
     and not exists (
       select 1
         from chapter_custom_roles c
        where c.chapter_id = p_chapter_id
          and c.id = any (v_current.custom_role_ids)
          and 'members:view' = any (c.capabilities)
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
       and not (v_member_role_id = any (
         select lower(x) from unnest(v_current.role_ids) as x
       )) then
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
