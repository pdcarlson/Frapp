-- The Member role becomes Everyone (#4191).
--
-- Paul, 2026-11-11: "@members should just be @everyone in my opinion, and
-- there should not be a member role." The seeded Member role (`system_key`
-- MEMBER) is renamed Everyone, and the clients stop offering it anywhere: no
-- role list, chip, filter or picker shows it, and nobody ticks it on a
-- member. Pinging it is `@everyone`, which reaches every member of the chapter
-- and, by default, only officers may use. New chapters are seeded this way
-- (`DEFAULT_SYSTEM_ROLES` in apps/api/src/domain/constants/permissions.ts);
-- this brings existing chapters to the same place.
--
-- WHAT IT WRITES, per chapter
--
-- 1. Any other role whose name reads as `@everyone` (letters and digits only,
--    any case: "Everyone", "every-one") is renamed "<name> (role)", then
--    "<name> (role 2)" and so on if that is taken, so `@everyone` names one
--    role. Its id, holders and permissions don't change, and its pending
--    invites are pointed at the new name.
-- 2. Pending invites (not used, not revoked) whose role is the Member role's
--    current name are pointed at "Everyone", so a later role taking the old
--    name can't capture them. Redeemed and revoked invites are history and
--    keep the name they were sent with.
-- 3. The Member role is renamed Everyone, and its `mentionable` switch is
--    turned off: `@everyone` is for officers (holders of `channels:manage`,
--    `roles:manage` or `*`) until a chapter turns it on again.
--
-- WHAT IT DOESN'T: the role's id, `system_key`, tier, permissions, overrides,
-- color and holders are untouched, so every member's permissions and rank are
-- exactly what they were, and every stored reference to the role
-- (`members.role_ids`, `chapters.default_invite_role_id`, channel see and post
-- lists, events' attendance by role) means what it meant. It stays in its
-- tier on purpose: presidency's claim walk stops at that tier, and outside the
-- tiers it would rank below New members.
--
-- A chapter whose Member role lost its `system_key` (the legacy backfill gap,
-- spec/behavior/rbac.md) has no Everyone role and is not touched.
--
-- Runs on staging when this merges, and on production only when Paul deploys
-- it. Idempotent: a second run finds nothing left to rename. No audit row is
-- written, as for the earlier seeded-role backfills: this is a product
-- change, not an officer's.

do $$
declare
  r record;
  candidate text;
  n integer;
begin
  -- 1. Free the name for every chapter that has an Everyone role to give it.
  for r in
    select o.id, o.chapter_id, o.name
      from public.roles o
     where (o.system_key is distinct from 'MEMBER')
       and lower(regexp_replace(o.name, '[^[:alnum:]]', '', 'g')) = 'everyone'
       and exists (
         select 1 from public.roles m
          where m.chapter_id = o.chapter_id and m.system_key = 'MEMBER'
       )
     order by o.chapter_id, o.name, o.id
  loop
    n := 1;
    loop
      candidate := left(r.name, 90) || case when n = 1 then ' (role)' else ' (role ' || n || ')' end;
      exit when not exists (
        select 1 from public.roles x
         where x.chapter_id = r.chapter_id and x.name = candidate
      );
      n := n + 1;
    end loop;
    update public.roles set name = candidate where id = r.id;
    -- Its pending invites follow it: they are matched by name at redeem, and
    -- the old name is about to be the Everyone role's.
    update public.invites
       set role = candidate
     where chapter_id = r.chapter_id
       and role = r.name
       and used_at is null
       and revoked_at is null;
  end loop;

  -- 2. Pending invites naming the Member role by its current name.
  update public.invites i
     set role = 'Everyone'
    from public.roles m
   where m.chapter_id = i.chapter_id
     and m.system_key = 'MEMBER'
     and m.name <> 'Everyone'
     and i.role = m.name
     and i.used_at is null
     and i.revoked_at is null;

  -- 3. The rename and the switch.
  update public.roles
     set name = 'Everyone',
         mentionable = false
   where system_key = 'MEMBER'
     and (name <> 'Everyone' or mentionable);
end
$$;
