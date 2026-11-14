-- Scheduled chat messages may carry files, a quote reply, or go into a thread
-- (#4971; spec/behavior/chat/README.md § Scheduled messages).
--
-- `attachments`: the claims the live send takes (`storage_path`, `filename`,
-- `content_type`, and a photo's size, ThumbHash and preview path), already
-- uploaded through `POST /v1/channels/{id}/upload-url`. The sweep passes them
-- to the send as they are. Deleting the row deletes the uploaded objects (the
-- API does it, not a trigger); a row that posts hands them to its message.
--
-- `reply_to_id` / `thread_root_id`: the quote and the thread, at most one, as
-- on a live send. No foreign key on either: a quoted message removed by the
-- time it posts loses only the quote, and a thread root removed refuses the
-- send, which marks the row failed, as the send's own checks decide. A key
-- would have to pick one of those for both, or delete the member's message.
--
-- The text may now be empty when there are files, as a live send's may.
--
-- Locks. Adding columns with a constant default is a catalog change. The
-- constraints are added NOT VALID and validated after, so the ACCESS
-- EXCLUSIVE lock is held only for the catalog change; the table is small.

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
  'Uploaded file claims the send takes, as SendMessageDto.attachments. Deleted from storage by the API when the row is deleted unsent.';
comment on column public.chat_scheduled_messages.reply_to_id is
  'The message this one quotes. No foreign key: a quote gone by send time is dropped.';
comment on column public.chat_scheduled_messages.thread_root_id is
  'The thread this posts into. No foreign key: a root gone by send time fails the row.';
