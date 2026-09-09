-- Rename the seeded system actor display_name from 'Frapp System' to
-- 'Signet System' (#1935).
--
-- The actor is the well-known row at
-- users.id = 00000000-0000-0000-0000-000000000000, inserted by
-- 20260524120000_chapter_directory_requests.sql. Chat cards do not print this
-- name today, but any surface that later reads users.display_name for the
-- system sender would still show the old product name. The historical seed is
-- left untouched; this is a forward data fix.
--
-- Matches on id only. Idempotent: a re-run is a no-op once the name is already
-- 'Signet System'. Leaves system@frapp.local, SYSTEM_SENDER_ID, and frapp://
-- protocol identifiers alone — those are not customer copy.
--
-- NOT applied to any hosted project as part of this change. Promotion to
-- staging and production follows docs/internal/ops/DB_PROMOTION_RUNBOOK.md.
-- Staging applies automatically on merge to main; production waits for
-- Deploy production. Do not dispatch that workflow from this change.

update public.users
set display_name = 'Signet System'
where id = '00000000-0000-0000-0000-000000000000'
  and display_name is distinct from 'Signet System';
