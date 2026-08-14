-- Backfill chapters.accent_color from branding.colors.accent (#795).
--
-- The onboarding wizard wrote the officer's chosen accent into the `branding`
-- jsonb and into the derived `theme_palette`, but never into the
-- `chapters.accent_color` column, which therefore kept its schema default
-- '#2563EB'. Every surface that reads the column — the web dashboard shell,
-- mobile chapter branding, and the membership summary in packages/hooks —
-- showed Royal Blue for a chapter that had picked something else. Surfaces
-- reading `theme_palette` were branded correctly, which is why this stayed
-- invisible on web for so long.
--
-- The API now treats `branding.colors.accent` as authoritative and mirrors it
-- into the column on every write path, so new and edited chapters are correct.
-- This repairs the rows written before that.
--
-- Idempotent, and safe to re-run: it is a plain UPDATE with no DDL, it only
-- touches rows whose branding actually holds a well-formed hex accent that
-- differs from the column, and `is distinct from` handles the NULL column case
-- that a plain `<>` would skip.
--
-- NOT applied to any hosted project as part of this change. Promotion to
-- staging and production follows docs/internal/ops/DB_PROMOTION_RUNBOOK.md.

update public.chapters
set accent_color = branding -> 'colors' ->> 'accent'
where branding -> 'colors' ->> 'accent' ~ '^#[0-9A-Fa-f]{6}$'
  and accent_color is distinct from branding -> 'colors' ->> 'accent';
