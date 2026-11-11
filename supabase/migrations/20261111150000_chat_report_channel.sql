-- The channel a reported message was in, snapshotted when the report is filed,
-- so Chat admin can show one channel's reports beside that channel's settings
-- (Paul, 2026-11-11: "scope the chat admin panel to whatever channel you're
-- editing").
--
-- A snapshot rather than a join through message_id, for the reason the
-- reported_* columns are (20260915210000_chat_reports_and_blocks.sql): the
-- message can be hard-deleted by the Discord import purge, and message_id is
-- then null. `on delete set null` for the same reason message_id has it: a
-- channel delete must not take its reports with it. The report then still
-- shows in the chapter-wide queue.
--
-- An id only. It opens nothing: a report about a DM still does not open the DM
-- (spec/behavior/chat/README.md § Report and block).

alter table public.chat_message_reports
  add column if not exists channel_id uuid
    references public.chat_channels(id) on delete set null;

update public.chat_message_reports r
   set channel_id = m.channel_id
  from public.chat_messages m
 where r.message_id = m.id
   and r.channel_id is null;

create index if not exists idx_chat_message_reports_channel_status
  on public.chat_message_reports (channel_id, status, created_at desc)
  where channel_id is not null;
