-- Members create events and upload backwork by default (#3709).
--
-- Paul, 2026-11-07: start from social trust and let chapters tighten it,
-- after his tester holding Vice President could not create an event. New
-- chapters get this from `STARTING_ROLE_TIERS`
-- (`apps/api/src/domain/constants/permissions.ts`); this carries the same two
-- keys, `events:create` and `backwork:upload`, to chapters that already exist.
--
-- `events:create` does not let a member make anyone required or attach
-- points: `POST /v1/events` refuses the first and stores no points unless the
-- maker holds `events:update` (`EventService.create`).
--
-- WHAT IT WRITES
--
-- In each chapter, the tier holding the seeded Member role (`system_key`
-- MEMBER), and every tier ranked above it (a lower `position`), gains
-- whichever of the two keys it lacks. Officers' tiers are included so that an
-- officer whose roles don't include Member, as an officer invited straight
-- into their own role doesn't, can do what the members they lead can. Tiers
-- ranked below the Member role's (New members) are left alone, and so are
-- roles outside the tiers, which hold what they hold through overrides.
-- `trg_role_tiers_sync_roles` then rewrites `roles.permissions` on every role
-- in those tiers, each with its own overrides applied: a role a chapter has
-- switched a key off for keeps it off.
--
-- A chapter whose Member role sits outside the tiers instead gets the keys it
-- lacks as "on" overrides on that role, unless the role already has an
-- override for that key either way.
--
-- A chapter with no Member role is not touched.
--
-- Runs on staging when this merges, and on production only when Paul deploys
-- it. Idempotent: only missing keys are added, in a fixed order, and a tier
-- or role that already has both is not written. No audit row is written:
-- like every earlier permission backfill, this is a product default, not an
-- officer's change.

with member_tier as (
  select t.chapter_id, t.position
    from public.roles r
    join public.role_tiers t on t.id = r.tier_id
   where r.system_key = 'MEMBER'
)
update public.role_tiers t
   set permissions = t.permissions || (
     select array_agg(k.key order by k.ord)
       from unnest(array['events:create', 'backwork:upload'])
              with ordinality as k(key, ord)
      where k.key <> all (t.permissions)
   )
  from member_tier m
 where t.chapter_id = m.chapter_id
   and t.position <= m.position
   and not (t.permissions @> array['events:create', 'backwork:upload']);

update public.roles r
   set permission_overrides = r.permission_overrides || (
     select jsonb_object_agg(k.key, true)
       from unnest(array['events:create', 'backwork:upload']) as k(key)
      where k.key <> all (r.permissions)
        and not (r.permission_overrides ? k.key)
   )
 where r.system_key = 'MEMBER'
   and r.tier_id is null
   and exists (
     select 1
       from unnest(array['events:create', 'backwork:upload']) as k(key)
      where k.key <> all (r.permissions)
        and not (r.permission_overrides ? k.key)
   );
