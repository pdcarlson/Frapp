-- Asking Frapp to do something (#718, spec/behavior/ai.md § Asking Frapp to
-- do something), on the suggestions table (#4309).
--
-- An officer's request ("give 5 points to everyone who came tonight") is
-- answered with a card that waits for their Confirm. That card is a row of
-- `ai_suggestions`, so it is confirmed through the same accept path as every
-- other suggestion and no second proposal table exists (ADR-28 decision 11).
--
-- 1. Two more kinds: `points` (accepting it adjusts each named member's
--    points) and `event` (accepting it creates one event).
-- 2. One more source type: `request`, a member's own typed request. Its
--    `source_id` is that member's user id, and only they can open it.
--
-- Nothing is deleted with a member: a request's row expires a day after it
-- is written, and the hourly sweep clears it.
--
-- Locks. Dropping and re-adding a check takes ACCESS EXCLUSIVE on
-- `ai_suggestions` and scans it once to validate. The table ships in the
-- same release as this file and is empty, so that is milliseconds. Both new
-- checks are supersets of the old ones, so no existing row can fail them.

alter table public.ai_suggestions
  drop constraint if exists ai_suggestions_kind_check;
alter table public.ai_suggestions
  add constraint ai_suggestions_kind_check
    check (kind in ('task', 'points', 'event'));

alter table public.ai_suggestions
  drop constraint if exists ai_suggestions_source_type_check;
alter table public.ai_suggestions
  add constraint ai_suggestions_source_type_check
    check (source_type in ('meeting', 'event', 'channel', 'request'));
