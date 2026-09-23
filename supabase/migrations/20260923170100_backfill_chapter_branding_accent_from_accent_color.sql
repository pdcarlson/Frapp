-- #1165: complete the #795 accent mirror in the direction #795 did not cover,
-- so the palette backfill re-derives each chapter from the colour it shows.
--
-- `branding.colors.accent` is the authoritative accent, and `accent_color`
-- mirrors it (accent-engine.md §7). `20260814120000` repaired the rows where
-- branding held an accent the column lacked. The reverse case survived it:
-- until the Settings accent save learned to write the mirror back into
-- `branding`, a Settings edit wrote only the column (and the palette, derived
-- from the column). Those rows have no `branding.colors.accent` at all, and the
-- column is the only record of the colour the officer picked.
--
-- Every path that recomputes a palette seeds from `branding.colors.accent`:
-- `POST /v1/chapters/:id/theme-palette`, the config PATCH, and now the
-- stale-palette sweep that follows `20260923170000`. On such a row that seed is
-- absent, so a recompute paints house gold over the chapter's own colour.
-- Staging had one on 2026-09-23: `accent_color` `#7d007d`, no branding accent,
-- a palette derived from the purple. Without this repair the sweep would have
-- rebranded that chapter within an hour of deploying.
--
-- Which rows: branding has no accent, and the column holds a well-formed
-- `#RRGGBB` that is not the schema default `#2563EB`. The default is excluded
-- because it is what the column holds when nothing ever wrote it (the #795
-- header describes exactly that), and a chapter in that state paints house
-- gold today. Copying the default in would repaint it Royal Blue. A chapter
-- that deliberately picked exactly `#2563EB` in Settings before the mirror
-- existed is indistinguishable from one that never picked, and keeps house
-- gold. That is the one case this cannot recover.
--
-- The demo chapters `scripts/demo/demo-seed.sql` inserted before this change
-- match too: they carry `accent_color` `#EFB63B` (the brand house gold) and no
-- branding. They are repaired to that accent like any other, which is also what
-- mobile already painted for them; the seed now writes both stores itself, so a
-- demo chapter seeded after this migration ends up the same.
--
-- `branding.colors` is created when absent. A row whose `colors` holds
-- something other than an object is left alone rather than overwritten; the
-- API never writes one.
--
-- Idempotent and safe to re-run: a repaired row has a branding accent, so it
-- no longer matches. No information is lost: the value is copied from
-- `accent_color`, which is not modified. Data-only: no DDL.

update public.chapters
set branding = jsonb_set(
  case
    when branding -> 'colors' is null
      then jsonb_set(branding, '{colors}', '{}'::jsonb)
    else branding
  end,
  '{colors,accent}',
  to_jsonb(accent_color)
)
where jsonb_typeof(branding) = 'object'
  and (
    branding -> 'colors' is null
    or jsonb_typeof(branding -> 'colors') = 'object'
  )
  and branding -> 'colors' ->> 'accent' is null
  and accent_color ~ '^#[0-9A-Fa-f]{6}$'
  and lower(accent_color) <> '#2563eb';
