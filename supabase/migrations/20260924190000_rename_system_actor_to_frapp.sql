-- Rename the seeded system actor display_name from 'Signet System' to
-- 'Frapp System' (ADR-25 step 3, #2578).
--
-- ADR-25 names the product Frapp. 20260909120000 renamed this row the other
-- way (Frapp → Signet, #1935), and this reverses it. The actor is the
-- well-known row at users.id = 00000000-0000-0000-0000-000000000000, inserted
-- by 20260524120000_chapter_directory_requests.sql as 'Frapp System'. Chat
-- cards do not print this name today, but any surface that later reads
-- users.display_name for the system sender would show it.
--
-- Matches on id only. Idempotent: a re-run is a no-op once the name is already
-- 'Frapp System'. Leaves system@frapp.local, SYSTEM_SENDER_ID, and frapp://
-- protocol identifiers alone, which were never renamed.
--
-- NOT applied to any hosted project as part of this change. Promotion to
-- staging and production follows docs/internal/ops/DB_PROMOTION_RUNBOOK.md.
-- Staging applies automatically on merge to main; production waits for
-- Deploy production. Do not dispatch that workflow from this change.

update public.users
set display_name = 'Frapp System'
where id = '00000000-0000-0000-0000-000000000000'
  and display_name is distinct from 'Frapp System';
