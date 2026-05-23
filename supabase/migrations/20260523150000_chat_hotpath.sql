-- Chunk 02: chat hot-path schema extensions
--
-- Extends chat_messages with: kind (richer message types), payload (jsonb
-- for inline card data), client_message_id (idempotency key), deleted_at
-- (soft-delete replaces the existing boolean is_deleted).
--
-- Adds chat_message_actions for per-user reactions / RSVPs / votes.
-- Adds compound + partial indexes sized for high-volume chat queries.

-- ── chat_messages extensions ──────────────────────────────────────────────

-- kind: enriched type system. The existing `type` column stays for backward
-- compatibility (TEXT/POLL); `kind` carries the extended set going forward.
alter table chat_messages
  add column if not exists kind text not null default 'text',
  add column if not exists payload jsonb,
  add column if not exists client_message_id text,
  add column if not exists deleted_at timestamptz;

-- Partial unique index: deduplication on (chapter_id, sender_id, client_message_id).
-- Only enforced where client_message_id is not null (retried sends).
-- chat_messages doesn't have chapter_id directly; it's reached through channel.
-- Use (channel_id, sender_id, client_message_id) — channel is always chapter-scoped.
create unique index if not exists idx_chat_messages_dedupe
  on chat_messages (channel_id, sender_id, client_message_id)
  where client_message_id is not null;

-- Compound index for per-channel message list (primary query path)
create index if not exists idx_chat_messages_channel_created
  on chat_messages (channel_id, created_at desc);

-- ── chat_message_actions ──────────────────────────────────────────────────

create table chat_message_actions (
  id           uuid         primary key default gen_random_uuid(),
  message_id   uuid         not null references chat_messages(id) on delete cascade,
  user_id      uuid         not null references users(id) on delete cascade,
  action_type  text         not null,
  payload      jsonb        not null default '{}',
  created_at   timestamptz  not null default now()
);

-- Unique dedupe key matching the Edge Function's idempotency guarantee
create unique index idx_chat_message_actions_dedupe
  on chat_message_actions (message_id, user_id, action_type);

-- Message-level aggregation (reactions, RSVP counts per message)
create index idx_chat_message_actions_message_user
  on chat_message_actions (message_id, user_id);

-- User-level history (my reactions / RSVPs)
create index idx_chat_message_actions_user_type_created
  on chat_message_actions (user_id, action_type, created_at desc);

alter table chat_message_actions enable row level security;
