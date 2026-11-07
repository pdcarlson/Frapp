-- Give the Member role to anyone whose roles carry no member access
-- (2026-11-07).
--
-- A role a chapter made itself, or one a Discord import brought over, often
-- carries nothing but `channels:read:<slug>`. The access every member needs
-- (`members:view`, which guards the chapter, the channel list, tasks and the
-- rest) lives on the seeded roles. An invite issued with such a role used to
-- grant it alone, so the redeemer was refused on every screen: two testers
-- invited as "Cabinet" on 2026-11-07 could not load chat at all.
-- `InviteService.redeem` now adds Member beside such a role
-- (`spec/behavior/onboarding.md`).
--
-- This repairs the memberships made before that change. A member is repaired
-- when, among the roles they hold that exist in their own chapter (ids
-- compared as uuids, the way `PermissionsGuard` resolves them):
--   - there is at least one, so a member whose ids all point at deleted roles
--     is left alone, as is a member with no roles;
--   - none is seeded (`is_system`, which also covers seeded roles renamed
--     before `system_key` existed);
--   - none grants `members:view` or `*`, so a custom role an officer gave
--     member access on purpose is not widened.
-- Member is appended, not prepended: web's Members list labels a member by
-- their first role, which should stay the role they were invited as.
-- A chapter with no Member role is skipped. Idempotent: a repaired member
-- holds a seeded role and no longer matches.
with held as (
  select m.id as member_id, r.is_system, r.permissions
  from public.members m
  join public.roles r
    on r.chapter_id = m.chapter_id
   and r.id::text = any (
     select lower(x) from unnest(m.role_ids) as x
   )
),
locked_out as (
  select member_id
  from held
  group by member_id
  having not bool_or(is_system)
     and not bool_or(permissions && array['members:view', '*'])
)
update public.members m
set role_ids = array_append(m.role_ids, base.id::text)
from public.roles base, locked_out lo
where lo.member_id = m.id
  and base.chapter_id = m.chapter_id
  and base.system_key = 'MEMBER';
