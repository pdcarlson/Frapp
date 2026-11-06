-- Attendance by role (2026-11-06): an event can be required for some roles,
-- optional for others and not open to others, with a default for everyone
-- else (`spec/behavior/events.md` § Attendance by role).
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
-- All additive and nullable or defaulted, so a running API that predates
-- this keeps reading and writing events unchanged.
alter table public.events
  add column if not exists optional_role_ids text[],
  add column if not exists excluded_role_ids text[],
  add column if not exists others_invited boolean not null default true;

-- Today's targeted events keep reading the same: a non-empty
-- `required_role_ids` was "only these roles", so nobody else is invited.
update public.events
   set others_invited = false
 where coalesce(array_length(required_role_ids, 1), 0) > 0;
