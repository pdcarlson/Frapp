-- A role's name must have something besides whitespace (#4749). The API
-- refuses a blank name on create and update; this holds the same rule for
-- any other writer, the way pledge classes, role tiers and event types
-- already do (`btrim(name)` checks in 20261110170000, 20261111140000,
-- 20261111200000).
--
-- First, any role already stored with a blank name gets "Unnamed role" plus
-- the start of its id, so it reads in every list and stays unique under
-- `roles (chapter_id, name)`. Then the check is added.

update public.roles
   set name = 'Unnamed role ' || substr(id::text, 1, 8)
 where btrim(name) = '';

alter table public.roles
  drop constraint if exists roles_name_not_blank;

alter table public.roles
  add constraint roles_name_not_blank check (btrim(name) <> '');
