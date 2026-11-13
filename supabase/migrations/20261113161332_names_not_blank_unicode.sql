-- A name must have a character that isn't whitespace, with "whitespace" meaning
-- exactly what JavaScript's `\s` means (#4770). The API refuses a blank name
-- with `@Matches(/\S/)` and trims with `String.prototype.trim`, which strip the
-- same set. The five `*_name_not_blank` checks (#4749, #4756) used
-- `[^[:space:]]`, whose meaning depends on the column's collation: U+FEFF
-- passed it under every collation, and U+00A0 and U+202F under libc ones.
--
-- The bracket below lists JS's `\s` by code point, so no collation changes it:
-- tab, newline, vertical tab, form feed, carriage return, space, U+00A0,
-- U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF.
-- `scripts/pglite/tiers/names-not-blank.mjs` checks each constraint against
-- JS's `\s` over every BMP code point, so the two can't drift apart.
--
-- First, any row that the new check would refuse is renamed the way #4749 and
-- #4756 did ("Unnamed …" plus the start of its id). Pledge classes go first:
-- their trigger renames each class's own group to match.

update public.chapter_pledge_classes
   set name = 'Unnamed class ' || substr(id::text, 1, 8)
 where name !~ '[^\t\n\v\f\r    -     　﻿]';

update public.role_tiers
   set name = 'Unnamed tier ' || substr(id::text, 1, 8)
 where name !~ '[^\t\n\v\f\r    -     　﻿]';

update public.event_types
   set name = 'Unnamed type ' || substr(id::text, 1, 8)
 where name !~ '[^\t\n\v\f\r    -     　﻿]';

update public.chapter_groups
   set name = 'Unnamed group ' || substr(id::text, 1, 8)
 where name !~ '[^\t\n\v\f\r    -     　﻿]';

update public.roles
   set name = 'Unnamed role ' || substr(id::text, 1, 8)
 where name !~ '[^\t\n\v\f\r    -     　﻿]';

alter table public.chapter_pledge_classes
  drop constraint if exists chapter_pledge_classes_name_not_blank;
alter table public.chapter_pledge_classes
  add constraint chapter_pledge_classes_name_not_blank
  check (name ~ '[^\t\n\v\f\r    -     　﻿]');

alter table public.role_tiers
  drop constraint if exists role_tiers_name_not_blank;
alter table public.role_tiers
  add constraint role_tiers_name_not_blank
  check (name ~ '[^\t\n\v\f\r    -     　﻿]');

alter table public.event_types
  drop constraint if exists event_types_name_not_blank;
alter table public.event_types
  add constraint event_types_name_not_blank
  check (name ~ '[^\t\n\v\f\r    -     　﻿]');

alter table public.chapter_groups
  drop constraint if exists chapter_groups_name_not_blank;
alter table public.chapter_groups
  add constraint chapter_groups_name_not_blank
  check (name ~ '[^\t\n\v\f\r    -     　﻿]');

alter table public.roles
  drop constraint if exists roles_name_not_blank;
alter table public.roles
  add constraint roles_name_not_blank
  check (name ~ '[^\t\n\v\f\r    -     　﻿]');
