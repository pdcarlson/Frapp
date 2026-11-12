-- Members create events and upload backwork by default (#3709).
--
-- Paul, 2026-11-07: start from social trust and let chapters tighten it,
-- after his tester holding Vice President could not create an event. New
-- chapters get this from `STARTING_ROLE_TIERS`
-- (`apps/api/src/domain/constants/permissions.ts`); this carries the same two
-- keys, `events:create` and `backwork:upload`, to chapters that already exist.
--
-- `events:create` does not let a member make anyone required or attach
-- points: unless the maker holds `events:update`, `POST /v1/events` stores
-- the event as optional and worth 0 points (`EventService.create`).
--
-- Existing chapters' officer tiers are not given `events:update`: new
-- chapters' Exec board gets it, but here that is left to each chapter.
--
-- WHAT IT WRITES
--
-- In each chapter, keyed on the seeded Member role (`system_key` MEMBER):
--
-- - `events:create`: the tier holding the Member role, and every tier ranked
--   above it (a lower `position`), gains it if it lacks it.
-- - `backwork:upload`: members already held it, so the Member role's own tier
--   is not given it. The tiers ranked above gain it only if the Member role
--   holds it today: a chapter that took it away from its members has
--   tightened it, and its officers are not handed it back.
--
-- Officers' tiers are included so that an officer whose roles don't include
-- Member, as an officer invited straight into their own role doesn't, can do
-- what the members they lead can. Tiers ranked below the Member role's (New
-- members) are left alone, and so are roles outside the tiers, which hold
-- what they hold through overrides. `trg_role_tiers_sync_roles` then rewrites
-- `roles.permissions` on every role in those tiers, each with its own
-- overrides applied: a role a chapter has switched a key off for keeps it off.
--
-- A chapter whose Member role sits outside the tiers instead gets
-- `events:create` as an "on" override on that role, unless it already holds
-- it or has an override for it either way.
--
-- A chapter with no Member role is not touched.
--
-- Runs on staging when this merges, and on production only when Paul deploys
-- it. Idempotent: only missing keys are added, in a fixed order, and a tier
-- or role that already has what it would get is not written. No audit row is
-- written: like every earlier permission backfill, this is a product default,
-- not an officer's change.

with member_role as (
  select t.chapter_id,
         t.position,
         r.permissions @> array['backwork:upload'] as members_upload
    from public.roles r
    join public.role_tiers t on t.id = r.tier_id
   where r.system_key = 'MEMBER'
),
wanted as (
  select t.id,
         array_remove(
           array[
             'events:create',
             case when t.position < m.position and m.members_upload
                  then 'backwork:upload' end
           ],
           null
         ) as keys
    from public.role_tiers t
    join member_role m on m.chapter_id = t.chapter_id
   where t.position <= m.position
)
update public.role_tiers t
   set permissions = t.permissions || (
     select array_agg(k.key order by k.ord)
       from unnest(w.keys) with ordinality as k(key, ord)
      where k.key <> all (t.permissions)
   )
  from wanted w
 where t.id = w.id
   and not (t.permissions @> w.keys);

update public.roles r
   set permission_overrides =
         r.permission_overrides || jsonb_build_object('events:create', true)
 where r.system_key = 'MEMBER'
   and r.tier_id is null
   and not (r.permissions @> array['events:create'])
   and not (r.permission_overrides ? 'events:create');
