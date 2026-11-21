-- Chapter AI switches start on (#5294, Paul, 2026-11-17: "I would like more
-- AI stuff on by default").
--
-- Before this file a chapter with no `chapter_ai_settings` row had every
-- switch off, and got them on only when its president tapped Continue on
-- Meet Frapp AI or found the AI tab on web. From here every chapter has a
-- row, and a row nobody has changed has all three switches on. A member's
-- own yes on Meet Frapp AI is unchanged and still gates everything sent for
-- them (`spec/behavior/ai.md` § Consent).
--
-- - Rows that exist were written by a president (the API writes a row only
--   on a change), so they are left exactly as they are.
-- - `updated_at` is null on a row nobody has changed, so a settings page
--   doesn't claim "Last changed" for a default.
--
-- This file only changes the columns: its ACCESS EXCLUSIVE lock on
-- `chapter_ai_settings` is held for milliseconds and released at its commit.
-- The rows come in 20261117150255_chapter_ai_settings_seed.sql, whose
-- backfill enrols each chapter's chat for indexing and so runs outside this
-- lock.

-- 1. A row nobody changed: all on, no changer, no change time.
alter table public.chapter_ai_settings
  alter column ask_enabled set default true,
  alter column meeting_notes_enabled set default true,
  alter column chat_source_enabled set default true,
  alter column updated_at drop not null,
  alter column updated_at drop default;

comment on table public.chapter_ai_settings is
  'The president''s AI switches, one per feature family. Every chapter has a row from creation, all on with updated_at null until a president changes one (#5294). API only. See 20261112165040_ai_consent.sql, 20261117150254_chapter_ai_defaults_on.sql and 20261117150255_chapter_ai_settings_seed.sql.';
