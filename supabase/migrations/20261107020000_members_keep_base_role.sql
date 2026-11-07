-- Give the Member role back to anyone who holds only custom roles
-- (2026-11-07).
--
-- A role a chapter made itself, or one a Discord import brought over, has no
-- `system_key` and usually carries nothing but `channels:read:<slug>`. The
-- access every member needs (`members:view`, which guards the chapter, the
-- channel list, tasks and the rest) lives on the seeded roles. An invite
-- issued with such a role used to grant it alone, so the redeemer was
-- refused on every screen: two testers invited as "Cabinet" on 2026-11-07
-- could not load chat at all. `InviteService.redeem` now grants Member
-- alongside a role with no `system_key` (`spec/behavior/onboarding.md`).
--
-- This repairs the memberships made before that change: a member with at
-- least one role and no seeded one gets the chapter's Member role in front of
-- the roles they hold. A member with no roles at all is left alone (none in
-- production when written), and so is a chapter with no Member role.
-- Idempotent: a repaired member holds a seeded role and no longer matches.
update public.members m
set role_ids = array_prepend(base.id::text, m.role_ids)
from public.roles base
where base.chapter_id = m.chapter_id
  and base.system_key = 'MEMBER'
  and cardinality(m.role_ids) > 0
  and not exists (
    select 1
    from public.roles r
    where r.id::text = any (m.role_ids)
      and r.system_key is not null
  );
