-- #462 ([Save] Bookmark model, epic #430) — personal, private bookmarks.
--
-- Per spec/behavior/chat/README.md § Bookmarks (personal): any member can
-- bookmark any message they can see; bookmarks are private to the bookmarker,
-- and "no one else (not even channel admins) can see who bookmarked what".
--
-- This is the private counterpart to pin. Pin is a column ON the message
-- (`chat_messages.is_pinned`/`pinned_at`) because it is a chapter-public
-- property of the message itself — one pin, visible to everyone. A bookmark is
-- a fact about a (viewer, message) pair, so it cannot live on the message: N
-- members bookmarking one message is N rows, and putting a viewer-scoped set on
-- a chapter-public row is what would make it readable by everyone who can read
-- the message. The join table IS the privacy boundary, not decoration on it.
--
-- The same spec section's "no sender-extend on ephemerality" rule constrains
-- this table: a bookmark must not touch the message's lifecycle. Nothing here
-- writes to chat_messages, and there is no trigger — the message expires,
-- deletes and moderates exactly as it would have unbookmarked.

create table if not exists public.chat_message_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  message_id uuid not null references chat_messages(id) on delete cascade,
  -- Denormalized so the per-chapter list (AC 3) is a single indexed read rather
  -- than a two-hop join through chat_channels on every open. It is written from
  -- the REQUEST's chapter, not read off the channel row; what keeps the two in
  -- agreement is that the service authorizes the message through a
  -- chapter-scoped channel lookup before inserting, so a message from another
  -- chapter never reaches this table. There is deliberately no DB-level check
  -- tying this column to the message's channel -- it would need a trigger or a
  -- composite FK through chat_channels -- so that application check is the whole
  -- of the guarantee.
  chapter_id uuid not null references chapters(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Bookmarking is idempotent per member: the toggle inserts on conflict do
  -- nothing, so a double-tap (or an offline retry) cannot create a duplicate.
  unique (user_id, message_id)
);

-- The one read this table has: "my bookmarks in this chapter, newest first".
-- Ordered on the index so the list never sorts in memory as a member's
-- bookmarks accumulate.
create index if not exists idx_chat_message_bookmarks_user_chapter
  on public.chat_message_bookmarks (user_id, chapter_id, created_at desc);

-- Reverse direction: cascade deletes and the "is this message bookmarked by
-- anyone" shape both probe by message.
create index if not exists idx_chat_message_bookmarks_message
  on public.chat_message_bookmarks (message_id);

-- RLS enabled with ZERO policies, matching every sibling chat table
-- (channel_read_receipts, message_reactions, poll_votes): the API reaches this
-- only through the service-role client, which bypasses RLS, and no client ever
-- queries it directly.
--
-- For this table that default-deny is not merely the convention, it is the
-- privacy guarantee. A client-reachable SELECT policy — even one scoped
-- `user_id = auth.uid()` — is a standing invitation for the next policy edit to
-- widen it, and widening it by one predicate is exactly how "not even channel
-- admins can see who bookmarked what" would be lost. With no policy at all
-- there is no client-reachable read path to get wrong, and the privacy claim
-- holds structurally rather than by review. (Deliberately not repeating the
-- client-reachable-SELECT shape #1555 is open against.)
alter table public.chat_message_bookmarks enable row level security;
