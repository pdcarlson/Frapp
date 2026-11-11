-- Recruitment gets its own permissions (#4070).
--
-- Until now the rush routes asked only for the `rush` module and
-- `members:view`, so any member could look a prospect up, add one, vote and
-- record a bid. The API now also asks for `rush:view`, `rush:add`, `rush:vote`
-- and `rush:bid`. This gives every role that could do those things the keys
-- that match, so nobody loses anything on deploy (Paul, 2026-11-10: ship with
-- today's behaviour and let chapters tighten it).
--
-- A role is backfilled when:
--   - it holds `members:view`, which every rush route still requires;
--   - it does not hold `*`, which already grants everything;
--   - its chapter has not turned the rush module off. A module is on unless
--     `enabled_modules.rush` is exactly false (`isModuleEnabled` in
--     `@repo/validation`), so a chapter with no `rush` key counts as on.
-- Custom roles (`chapter_custom_roles.capabilities`) are read by the same
-- guard and get the same treatment.
--
-- The six keys are `RUSH_MEMBER_PERMISSIONS` in `@repo/validation`.
-- `rush:manage` (delete, export) is not granted: nobody can do either today.
--
-- Idempotent: only missing keys are appended, in a fixed order, and a role
-- that already holds all six is not touched.

update public.roles r
set permissions = r.permissions || (
  select array_agg(k.key order by k.ord)
  from unnest(array[
    'rush:view', 'rush:add', 'rush:notes',
    'rush:vote', 'rush:view_results', 'rush:bid'
  ]) with ordinality as k(key, ord)
  where k.key <> all (r.permissions)
)
from public.chapters c
where c.id = r.chapter_id
  and coalesce(c.enabled_modules ->> 'rush', 'true') <> 'false'
  and 'members:view' = any (r.permissions)
  and not ('*' = any (r.permissions))
  and not (r.permissions @> array[
    'rush:view', 'rush:add', 'rush:notes',
    'rush:vote', 'rush:view_results', 'rush:bid'
  ]);

update public.chapter_custom_roles r
set capabilities = r.capabilities || (
  select array_agg(k.key order by k.ord)
  from unnest(array[
    'rush:view', 'rush:add', 'rush:notes',
    'rush:vote', 'rush:view_results', 'rush:bid'
  ]) with ordinality as k(key, ord)
  where k.key <> all (r.capabilities)
)
from public.chapters c
where c.id = r.chapter_id
  and coalesce(c.enabled_modules ->> 'rush', 'true') <> 'false'
  and 'members:view' = any (r.capabilities)
  and not (r.capabilities @> array[
    'rush:view', 'rush:add', 'rush:notes',
    'rush:vote', 'rush:view_results', 'rush:bid'
  ]);
