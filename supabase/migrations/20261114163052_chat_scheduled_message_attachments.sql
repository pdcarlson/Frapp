-- Scheduled chat messages may carry files, a quote reply, or go into a thread
-- (#4971; spec/behavior/chat/README.md § Scheduled messages).
--
-- `attachments`: the claims the live send takes (`storage_path`, `filename`,
-- `content_type`, and a photo's size, ThumbHash and preview path), already
-- uploaded through `POST /v1/channels/{id}/upload-url`. The sweep passes them
-- to the send as they are; a row that posts hands them to its message. The
-- API's delete of a row deletes its uploads (not a trigger), keeping any a
-- message, a report or another scheduled row still needs. A row removed by a
-- cascade (chapter, channel, membership) leaves its uploads in storage, as an
-- abandoned live upload does, for the `chat` orphan sweep (#2197).
--
-- `reply_to_id` / `thread_root_id`: the quote and the thread, at most one, as
-- on a live send. No foreign key on either: a quoted message removed by the
-- time it posts loses only the quote, and a thread root removed refuses the
-- send, which marks the row failed, as the send's own checks decide. A key
-- would have to pick one of those for both, or delete the member's message.
--
-- The text may now be empty when there are files, as a live send's may.
--
-- Locks. The first ALTER takes ACCESS EXCLUSIVE on the table, and the file
-- runs in one transaction, so it holds until commit, through the three
-- validation scans. The table is new and small (a member holds at most 50
-- pending rows), so that is milliseconds. Writes no row.

alter table public.chat_scheduled_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb,
  add column if not exists reply_to_id uuid,
  add column if not exists thread_root_id uuid;

alter table public.chat_scheduled_messages
  drop constraint if exists chat_scheduled_messages_content_length;

alter table public.chat_scheduled_messages
  add constraint chat_scheduled_messages_attachments_list
    check (
      jsonb_typeof(attachments) = 'array'
      and jsonb_array_length(attachments) <= 10
    ) not valid,
  add constraint chat_scheduled_messages_content_length
    check (
      char_length(content) <= 10000
      and (
        char_length(btrim(content)) >= 1
        or (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) > 0)
      )
    ) not valid,
  add constraint chat_scheduled_messages_one_target
    check (reply_to_id is null or thread_root_id is null) not valid;

alter table public.chat_scheduled_messages
  validate constraint chat_scheduled_messages_attachments_list;
alter table public.chat_scheduled_messages
  validate constraint chat_scheduled_messages_content_length;
alter table public.chat_scheduled_messages
  validate constraint chat_scheduled_messages_one_target;

comment on column public.chat_scheduled_messages.attachments is
  'Uploaded file claims the send takes, as SendMessageDto.attachments. The API deletes them from storage when it deletes the row unsent; a cascade leaves them.';
comment on column public.chat_scheduled_messages.reply_to_id is
  'The message this one quotes. No foreign key: a quote gone by send time is dropped.';
comment on column public.chat_scheduled_messages.thread_root_id is
  'The thread this posts into. No foreign key: a root gone by send time fails the row.';
