-- #1165: record which accent engine wrote each chapter's `theme_palette`.
--
-- The palette is computed server-side and cached on the row, and nothing
-- regenerates it on read (spec/ui/design-system/accent-engine.md §4). Until now
-- nothing recorded which engine produced a stored row either, so every engine
-- change reached only the chapters that saved after it shipped. The #2541 fill
-- floor is the case that made this an accessibility gap rather than a cosmetic
-- one: a dark-accent row written before it still paints a sub-3:1
-- `accent-primary` (crimson `#8B0000` at 1.50:1 on `--popover`).
--
-- The API now writes `SIGNET_ENGINE_VERSION` (`@repo/chapter-theme`) into this
-- column beside every palette it writes, and an hourly sweep
-- (`ScheduledJobsService.sweepStalePalettes`) recomputes each row whose value is
-- NULL or lower than the running engine's. So:
--
--   * NULL means "written before this column existed", which is stale by
--     definition. Every existing row starts NULL, which is what makes the first
--     sweep after deploy recompute every chapter rather than only the ones
--     missing a key. A key-presence check would pass exactly the rows written
--     between #1147 and #2541 whose fills are wrong.
--   * No default, deliberately. A default would stamp rows as current that no
--     engine ever wrote.
--   * A column rather than a key inside the jsonb, so the map served to clients
--     stays a pure colour map, and "which rows are stale" is one predicate on
--     a scalar.
--
-- Additive only: one nullable column, no default, no constraint, no rewrite.
-- Old API code ignores it. Needs no account-deletion wiring (not personal data).

alter table public.chapters
  add column if not exists theme_palette_engine_version integer;

comment on column public.chapters.theme_palette_engine_version is
  'SIGNET_ENGINE_VERSION of the engine that wrote theme_palette; NULL or behind the running engine means stale, and the API''s hourly sweep recomputes it (#1165, accent-engine.md §4).';
