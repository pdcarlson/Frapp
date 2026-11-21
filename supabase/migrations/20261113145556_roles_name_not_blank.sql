-- A role's name must have something besides whitespace (#4749). The API
-- refuses a blank name on create and update; this holds the same rule for
-- any other writer. Pledge classes, role tiers and event types have a
-- `btrim(name)` check, but one-argument `btrim` strips only spaces, so a name
-- of tabs or newlines passes it. This check uses a regex instead: a name must
-- have one character that isn't whitespace, as the API's `/\S/` does.
--
-- First, any role already stored with such a name gets "Unnamed role" plus
-- the start of its id, so it reads in every list and stays unique under
-- `roles (chapter_id, name)`. Then the check is added.

update public.roles
   set name = 'Unnamed role ' || substr(id::text, 1, 8)
 where name !~ '[^[:space:]]';

alter table public.roles
  drop constraint if exists roles_name_not_blank;

alter table public.roles
  add constraint roles_name_not_blank check (name ~ '[^[:space:]]');
