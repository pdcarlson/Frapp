-- A pledge class, role tier, event type or group name must have something
-- besides whitespace (#4756), as a role's must (#4749). Each table's
-- `*_name_len` check measures `btrim(name)`, but one-argument `btrim` strips
-- only spaces, so a name of tabs or newlines passes it. The API refuses such
-- a name with `/\S/`; this holds the same rule for any other writer (SQL, a
-- seed, a future service path), with the regex the roles check uses.
--
-- chapter_document_types needs nothing: its `chapter_document_types_name_key`
-- check already requires a letter or digit.
--
-- First, any row already stored with such a name gets "Unnamed …" plus the
-- start of its id, so it reads in every list and stays unique under the
-- `lower(btrim(name))` indexes. Pledge classes go first: their trigger
-- renames each class's own group to match. The length checks stay.

update public.chapter_pledge_classes
   set name = 'Unnamed class ' || substr(id::text, 1, 8)
 where name !~ '[^[:space:]]';

update public.role_tiers
   set name = 'Unnamed tier ' || substr(id::text, 1, 8)
 where name !~ '[^[:space:]]';

update public.event_types
   set name = 'Unnamed type ' || substr(id::text, 1, 8)
 where name !~ '[^[:space:]]';

update public.chapter_groups
   set name = 'Unnamed group ' || substr(id::text, 1, 8)
 where name !~ '[^[:space:]]';

alter table public.chapter_pledge_classes
  drop constraint if exists chapter_pledge_classes_name_not_blank;
alter table public.chapter_pledge_classes
  add constraint chapter_pledge_classes_name_not_blank
  check (name ~ '[^[:space:]]');

alter table public.role_tiers
  drop constraint if exists role_tiers_name_not_blank;
alter table public.role_tiers
  add constraint role_tiers_name_not_blank
  check (name ~ '[^[:space:]]');

alter table public.event_types
  drop constraint if exists event_types_name_not_blank;
alter table public.event_types
  add constraint event_types_name_not_blank
  check (name ~ '[^[:space:]]');

alter table public.chapter_groups
  drop constraint if exists chapter_groups_name_not_blank;
alter table public.chapter_groups
  add constraint chapter_groups_name_not_blank
  check (name ~ '[^[:space:]]');
