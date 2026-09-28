-- Let a chapter take a deleted Discord import off its list (#2817).
--
-- Every import a chapter ever made stays on the Discord import page, purged
-- ones included, because the purge keeps the job row as the record that the
-- import happened. Clearing hides that record from the list without deleting
-- it.
--
--   cleared_at  when the chapter cleared it; null while it is listed.
--
-- Nullable with no default, so every existing import stays listed. The API
-- sets it only on a purged import: the list is where an import is deleted
-- from, so one that still holds what it brought in stays listed.

alter table public.discord_imports
  add column if not exists cleared_at timestamptz;
