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
-- that deletes those branches drops the column and its unique index.

-- Stop a new chapter's seeding (or an older API's) flagging a
-- `#chapter-audit`: the API no longer seeds one, and a channel an officer
-- names that way is an ordinary channel.
drop trigger if exists chat_channels_flag_audit_log on public.chat_channels;
drop function if exists public.chat_channels_flag_audit_log();

delete from public.chat_channels
where is_audit_log;
