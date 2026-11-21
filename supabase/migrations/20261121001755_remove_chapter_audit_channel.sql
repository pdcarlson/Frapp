-- The chapter's record of officer changes moves out of chat (Paul,
-- 2026-11-21): officers read `chapter_audit_log` on the Logs page in Chapter
-- settings, and `#chapter-audit` goes.
--
-- The channel only ever held a copy of those rows. The API's audit mirror
-- (`ChatBridgeWorkerService`, deleted with this change) posted one
-- `system_audit` line per member-visible `chapter_audit_log` row, and no
-- member could post there (#3909). `chapter_audit_log` is untouched, so no
-- entry is lost: it holds every row the channel did, and the ones the mirror
-- missed while it was down.
--
-- Deleting the channel cascades to its messages, reads, pins, reactions and
-- notification preferences; a report or forward that pointed at one of its
-- lines keeps its row with the reference set to null.
--
-- `is_audit_log` stays for now: the API and both clients still read it in
-- places that become unreachable once no channel carries it. The follow-up
-- that deletes those branches (#5808) drops the column and its unique index.

-- Drop the trigger that flagged a new `#chapter-audit`. The API this ships
-- with seeds none. An older API still running during the rollout sets
-- `is_audit_log` itself when it seeds a chapter, so a chapter created in that
-- window can get a flagged channel after this delete has run; #5808 repeats
-- this delete before it drops the column, which clears any such straggler.
drop trigger if exists chat_channels_flag_audit_log on public.chat_channels;
drop function if exists public.chat_channels_flag_audit_log();

delete from public.chat_channels
where is_audit_log;
