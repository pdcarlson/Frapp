-- Let a chapter take a finished Discord import off its list (#2817).
--
-- Every import a chapter ever made stays on the Discord import page, purged
-- ones included, because the purge keeps the job row as the record that the
-- import happened. Clearing hides the row from the list without deleting it
-- and without touching anything the import brought in: a completed import's
-- messages and channels stay exactly where they are.
--
--   cleared_at  when the chapter cleared it; null while it is listed.
--
-- Nullable with no default, so every existing import stays listed. The API
-- sets it only on a finished import (completed, failed, cancelled, purged).

alter table public.discord_imports
  add column if not exists cleared_at timestamptz;
