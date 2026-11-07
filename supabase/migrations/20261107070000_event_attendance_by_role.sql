-- Attendance by role (2026-11-06): an event can be required for some roles,
-- optional for others and not open to others, with a default for everyone
-- else (`spec/behavior/events.md` § Event Creation, "Attendance by role").
--
-- Before this, `required_role_ids` did two jobs at once: it named the roles
-- that must attend AND it was the whole audience (a member holding none of
-- them could not see the event). So "required for officers, optional for
-- everyone else" could not be said. The audience moves to its own columns:
--
--   optional_role_ids  roles invited but not required
--   excluded_role_ids  roles not invited
--   others_invited     whether a member holding none of the listed roles is
--                      invited (then `is_mandatory` says if they must attend)
--
-- `others_invited` is nullable with no default, and there is no backfill:
-- null reads with the older meaning, "invited unless `required_role_ids` is
-- non-empty" (`eventOthersInvited` in `@repo/validation`). A row an older API
-- writes after this runs (staging applies migrations before the API deploys,
-- and production can apply them ahead of the code) never sets the column, so
-- it keeps meaning what that API meant. A one-time backfill would have frozen
-- the old meaning only for rows that existed when it ran.
--
-- Rolling the API back past this change is safe for rows written as null.
-- An event saved by the new editors (optional or excluded roles, or an
-- explicit `others_invited`) can read differently to an older API, so don't
-- redeploy a commit before this once such events exist.
alter table public.events
  add column if not exists optional_role_ids text[],
  add column if not exists excluded_role_ids text[],
  add column if not exists others_invited boolean;
