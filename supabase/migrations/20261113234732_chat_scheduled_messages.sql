-- Chat messages a member scheduled to send later (#4956;
-- spec/behavior/chat/README.md § Scheduled messages).
--
-- One row per pending message. At `send_at` the API's sweep posts it into
-- the channel as its author, through the same send path a live post takes,
-- so it gets the same pushes, mentions and permission check. A message that
-- posts is deleted from here; one the author can no longer post (they lost
-- access to the channel, or the chapter is read-only for billing) stays as
-- `failed` with a code saying why, until they edit or delete it.
--
-- `lease_until` is the sweep's claim: on several API replicas only the one
-- that set it sends the row, and a replica that died mid-send leaves it to be
-- taken again once the lease runs out. The row's own id is the message's
-- `client_message_id`, so a send retried after a crash answers the message
-- already posted instead of posting it twice.
--
-- Rows go with the chapter, the channel, and the author's membership. The
-- membership is what makes them go when the author leaves the chapter or
-- deletes their account: `anonymize_user` deletes the `members` rows and
-- keeps the `users` row as a tombstone, so a cascade from `users` alone would
-- never fire. RLS is on with no policies: the API is the only reader and
-- writer, and serves a member only their own rows.
--
-- Locks. The foreign keys add triggers to `chapters`, `chat_channels`,
-- `members` and `users`, taking a SHARE ROW EXCLUSIVE lock on each until commit. The table
-- is new and empty, so that is milliseconds. Writes no row.

create table if not exists public.chat_scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  channel_id uuid not null references chat_channels(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  content text not null,
  -- The composer's `@` picks (#3835), passed to the send as they are.
  mention_picks jsonb,
  send_at timestamptz not null,
  status text not null default 'pending',
  failure_reason text,
  attempts integer not null default 0,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_scheduled_messages_content_length
    check (char_length(btrim(content)) between 1 and 10000),
  constraint chat_scheduled_messages_status_known
    check (status in ('pending', 'failed')),
  constraint chat_scheduled_messages_failure_reason_known
    check (
      (status = 'pending' and failure_reason is null)
      or (status = 'failed' and failure_reason in ('no_access', 'chapter_locked', 'not_sendable', 'send_failed'))
    ),
  constraint chat_scheduled_messages_attempts_not_negative
    check (attempts >= 0)
);

-- The sweep: pending rows that are due.
create index if not exists chat_scheduled_messages_due
  on public.chat_scheduled_messages (send_at)
  where status = 'pending';
-- A member's own list, in one chapter, optionally one channel.
create index if not exists chat_scheduled_messages_author
  on public.chat_scheduled_messages (chapter_id, user_id, channel_id, send_at);
-- The cascades from `chat_channels`, `members` and `users`.
create index if not exists chat_scheduled_messages_channel
  on public.chat_scheduled_messages (channel_id);
create index if not exists chat_scheduled_messages_user
  on public.chat_scheduled_messages (user_id);
create index if not exists chat_scheduled_messages_member
  on public.chat_scheduled_messages (member_id);

alter table public.chat_scheduled_messages enable row level security;

comment on table public.chat_scheduled_messages is
  'Chat messages a member scheduled to post later; the API sweep posts each at send_at as its author. API only. See 20261113234732_chat_scheduled_messages.sql.';
