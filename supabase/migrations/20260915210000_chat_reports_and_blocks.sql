-- Member-level report and block for chat (#2257) — App Store Guideline 1.2.
--
-- Signet ships chapter channels, DMs and file uploads: that is user-generated
-- content, and Guideline 1.2 expects a UGC app to let a member report
-- objectionable content and block an abusive user. Officer moderation
-- (`channels:manage`) already exists but does not reach a private DM, which is
-- precisely the surface a reviewer probes. These two tables are the backing
-- state for the member-side controls.
--
-- Contract: spec/behavior/chat/README.md § Report and block.
--
-- Grain, and why each is a table rather than a column:
--
--   A report is a fact about a (reporter, message) pair, and N members
--   reporting one message is N rows, so it cannot live on chat_messages.
--   A block is a fact about a (blocker, blocked, chapter) triple, so it cannot
--   live on members either -- the escape hatch used by
--   20260905030000_member_dismissed_ops_nudges.sql (put the state on `members`
--   so it cascades and needs no anonymize_user wiring) only works for
--   one-row-per-member state, and both of these are N-per-member.
--
-- Both are chapter-scoped. #2257 asks the question explicitly, because a member
-- can belong to more than one chapter (spec/behavior/multi-tenancy.md): a block
-- is scoped PER CHAPTER, like every other chat rule, not per user account. The
-- blocked-member relationship is an artifact of a shared chapter context, and a
-- member who blocks someone in one chapter has said nothing about a different
-- chapter they may both also belong to.
--
-- Keyed on users(id), not members(id). chat_messages.sender_id is a users(id)
-- (00000000000000_initial_schema.sql:215, nullable since
-- 20260823120000_chat_message_authors.sql for Discord-imported rows), so the
-- masking predicate compares sender_id against a set of user ids. Keying the
-- block list on members(id) would force a join on every masked read and would
-- silently drop blocks when a member row is recreated.

create table if not exists public.chat_message_reports (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  -- NULLABLE, and `on delete set null` rather than cascade, because a report
  -- must outlive the message it names. chat_messages is soft-deleted in the
  -- ordinary case, but it is HARD-deleted on two live paths: the Discord
  -- import purge (supabase-discord-import.repository.ts deleteImportedMessages)
  -- and a channel delete, which is a genuine DELETE on chat_channels and
  -- cascades chat_messages via the initial-schema FK. Under `on delete cascade`
  -- an officer holding `channels:manage` could erase every report filed against
  -- their own messages by deleting the channel -- including reports already
  -- marked `actioned` -- and semester-end channel archiving would silently wipe
  -- an unreviewed moderation queue.
  message_id uuid references chat_messages(id) on delete set null,
  -- No `on delete` clause, matching chat_messages.sender_id: a users row is
  -- never deleted. Account deletion TOMBSTONES it (see anonymize_user), so the
  -- reporter of a retained report renders as "Deleted User" rather than
  -- vanishing -- the chapter_audit_log.actor_user_id precedent
  -- (20260523130000_audit_log.sql:11).
  reporter_user_id uuid not null references users(id),
  -- Evidence, snapshotted at report time. Without it the report names a message
  -- whose content the reported member controls: ChatService.deleteMessage lets
  -- a sender soft-delete their OWN message, which overwrites content with
  -- '[message deleted]' and metadata with '{}'. That gives every reported
  -- member a one-tap way to blank the evidence while leaving an unactionable
  -- report in the queue. Taken together with the nullable message_id above, the
  -- report is self-contained: an officer can act on it whatever happened to the
  -- row it points at.
  --
  -- This is deliberately a copy of chapter-visible content that a member has
  -- already seen, not new surveillance -- and it is retained through the
  -- reporter's account deletion. spec/behavior/data-retention.md records that.
  reported_content text,
  reported_sender_id uuid references users(id),
  -- chat_messages enforces `sender_id is not null or author_name is not null`
  -- so that no message is ever anonymous. A Discord-imported row carries the
  -- author in `author_name` with a NULL sender_id, so mirroring sender_id alone
  -- would snapshot nobody -- and once the import purge or a channel delete
  -- hard-deletes the message, the officer is left with content and no author at
  -- all. Carrying both halves keeps that invariant on this side of the copy.
  reported_author_name text,
  reason text not null,
  -- Optional free text from the reporter. Capped so a report cannot be used as
  -- a storage channel.
  details text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references users(id),
  constraint chat_message_reports_reason_check
    check (reason in ('spam', 'harassment', 'hate', 'violence', 'sexual', 'self_harm', 'other')),
  constraint chat_message_reports_status_check
    check (status in ('open', 'reviewed', 'actioned', 'dismissed')),
  constraint chat_message_reports_details_len
    check (details is null or char_length(details) <= 1000)
);

-- Idempotency, scoped to OPEN reports only.
--
-- A plain `unique (reporter_user_id, message_id)` was the first shape here and
-- it is wrong: it conflates "the same report submitted twice" with "the same
-- reporter, later, about something genuinely different". A sender can edit a
-- message indefinitely (ChatService.editMessage checks ownership and
-- is_deleted, never report state), so under the plain constraint a link
-- reported as spam and dismissed could be edited into targeted harassment and
-- never be reportable again -- the second report is either a silent no-op
-- under `on conflict do nothing` or a 23505 surfaced as a 500.
--
-- Partial on `status = 'open'` keeps the property that actually matters -- a
-- double-tap or an offline retry cannot queue the same message twice for the
-- same reporter -- while letting a resolved report be superseded.
--
-- Rows whose message_id has gone NULL (the message was hard-deleted) ARE in
-- this index -- the predicate is on `status`, not on message_id -- and simply
-- never collide, because a btree unique index is NULLS DISTINCT by default.
-- That distinction matters because the obvious-looking hardening is to add
-- `nulls not distinct`, and this repo has precedent for doing exactly that
-- (20260823120000_chat_message_authors.sql:104, when sender_id became
-- nullable). DO NOT add it here: several open reports by one reporter can have
-- their message_id nulled by a single `on delete set null` cascade, and under
-- NULLS NOT DISTINCT that cascade raises a unique violation -- which would
-- block the channel delete itself with a 23505 surfacing as a 500.
create unique index if not exists chat_message_reports_one_open_per_reporter
  on public.chat_message_reports (reporter_user_id, message_id)
  where status = 'open';

-- The officer queue: "open reports in this chapter, newest first". Ordered on
-- the index so the queue never sorts in memory as reports accumulate.
create index if not exists idx_chat_message_reports_chapter_status
  on public.chat_message_reports (chapter_id, status, created_at desc);

-- Reverse direction: backs the `on delete set null` from chat_messages, and the
-- "has this message been reported" probe.
create index if not exists idx_chat_message_reports_message
  on public.chat_message_reports (message_id);

create table if not exists public.chat_member_blocks (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  blocker_user_id uuid not null references users(id) on delete cascade,
  blocked_user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- A member cannot block themselves. Without this the mask would hide the
  -- member's own messages from them, which reads as data loss rather than as a
  -- block.
  constraint chat_member_blocks_not_self
    check (blocker_user_id <> blocked_user_id),
  -- Nor the system actor. SYSTEM_SENDER_ID
  -- (apps/api/src/domain/constants/chat.ts) is a real seeded users row, and it
  -- is the literal sender_id on server-originated messages: the chapter welcome
  -- post, the #chapter-audit bridge, invite-accept DMs, and the poll-expiry
  -- notice (a poll and its tally are authored by the member who created it --
  -- `poll` is not in SERVER_ONLY_KINDS -- so those are not in this set).
  -- Blocking it would mask
  -- every one of those in the chapter with no affordance to undo, because
  -- nothing renders as "blocked" -- it would read as chapter features quietly
  -- breaking. anonymize_user carries an explicit guard for the same actor and
  -- the same reason.
  constraint chat_member_blocks_not_system
    check (blocked_user_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  -- Blocking is idempotent per chapter: the toggle inserts on conflict do
  -- nothing.
  unique (chapter_id, blocker_user_id, blocked_user_id)
);

-- Deliberately just `(blocker_user_id)`, and deliberately NOT
-- `(blocker_user_id, chapter_id)`.
--
-- The hot read is "the set of user ids I have blocked in this chapter", fetched
-- once per chat session, and it supplies equality quals on both chapter_id and
-- blocker_user_id -- so the unique constraint's implicit index above already
-- serves it, verified by EXPLAIN. A second index carrying the same prefix earns
-- nothing on that path and costs a write on every block and unblock.
--
-- What the unique index CANNOT serve is a lookup by blocker alone, because it
-- leads with chapter_id. That is the account-deletion purge in
-- 20260915210100, which without this index falls to a sequential scan inside
-- the transaction that holds `for update` on the users row.
create index if not exists idx_chat_member_blocks_blocker
  on public.chat_member_blocks (blocker_user_id);

-- RLS enabled with ZERO policies on both tables, matching every sibling chat
-- table (channel_read_receipts, message_reactions, poll_votes,
-- chat_message_bookmarks): the API reaches them only through the service-role
-- client, which bypasses RLS, and no client queries them directly.
--
-- For chat_member_blocks that default-deny is not merely the convention, it is
-- the safety guarantee, and the failure mode is worse than for bookmarks. The
-- tempting policy is a "members can read their own block list" SELECT scoped
-- `blocker_user_id = auth.uid()`. It is not safe as a starting point: the next
-- edit that makes visibility "symmetric" -- adding `or blocked_user_id =
-- auth.uid()` so a member can see their own status -- turns a safety feature
-- into a notification to the abuser, telling them exactly who has blocked them.
-- With no policy at all there is no client-reachable read path to get that
-- predicate wrong, and the guarantee holds structurally rather than by review.
--
-- The same reasoning covers chat_message_reports from the other side: a
-- reporter must never be discoverable by the reported member, and a policy is
-- the only way that becomes possible.
-- #494, needed by the purge 20260915210100 adds. rush_candidate_votes has a
-- unique (candidate_id, voter_id) and an index on (chapter_id); neither leads
-- with voter_id, so `delete ... where voter_id = ?` sequentially scans the
-- ballot table inside the transaction that holds `for update` on the users row.
-- Measured on the local stack at 100k ballots: 1,235 buffers and 8.3ms as a Seq
-- Scan, against 10 buffers and 0.1ms with this index. The FK's `on delete
-- cascade` does not create one.
create index if not exists idx_rush_candidate_votes_voter
  on public.rush_candidate_votes (voter_id);

alter table public.chat_message_reports enable row level security;
alter table public.chat_member_blocks enable row level security;

comment on table public.chat_message_reports is
  'Member-filed reports against chat messages (Guideline 1.2). Contract: spec/behavior/chat/README.md § Report and block.';

comment on table public.chat_member_blocks is
  'Per-chapter member block list (Guideline 1.2). Contract: spec/behavior/chat/README.md § Report and block.';
