-- Chat push dispatch claims (#2846, #2507).
--
-- `ChatPushWorkerService` subscribes to Postgres Changes on `chat_messages`
-- INSERT in every API process, and Realtime delivers every event to every
-- subscriber. With two instances (a scaled service, or the brief overlap of a
-- deploy) every recipient got every push twice, plus a second notification row.
--
-- The primary key is the concurrency control, as in
-- `scheduled_notification_dispatches`: the worker inserts a row for the message
-- before it reads anything, and only the instance whose insert wins fans the
-- message out. A duplicate-key violation means another instance owns it.
--
-- One claim per message, not per recipient: the winning instance does the whole
-- fan-out, which is the same guarantee for one insert instead of one per member.
--
-- A claim only has to outlive the Realtime redelivery window, which is seconds.
-- The worker purges claims older than a day every hour, so the table stays
-- small instead of growing one row per chat message. The foreign key drops a
-- claim with its message on a hard delete, and turns a claim for a message
-- deleted before its push into a failed insert, which skips the push.
create table public.chat_push_dispatches (
  message_id uuid primary key references public.chat_messages(id) on delete cascade,
  dispatched_at timestamptz not null default now()
);

-- Serves the hourly purge, `delete ... where dispatched_at < now() - 1 day`.
create index idx_chat_push_dispatches_dispatched_at
  on public.chat_push_dispatches (dispatched_at);

alter table public.chat_push_dispatches enable row level security;

-- No client policies: API-only (service role), like
-- `scheduled_notification_dispatches`. It holds delivery bookkeeping; members
-- read the resulting notifications from `notifications`.
