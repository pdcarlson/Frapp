-- The Discord archive importer (phase 2 of the migration tool). Phase 1 built
-- the schema an imported message needs; this adds the identity that makes an
-- import re-runnable, and the two tables that track an import while it runs.
--
-- WHY A DEDICATED external_message_id RATHER THAN client_message_id
--
-- Phase 1 (20260823120000) put the Discord message snowflake in
-- `client_message_id` and taught `idx_chat_messages_dedupe` to enforce on it by
-- adding NULLS NOT DISTINCT. That was flagged for review at the time and is
-- reversed here. `client_message_id` is the *client's* optimistic-send
-- idempotency key (ADR-03): it is minted by the composer, it round-trips through
-- the offline outbox, and the mobile/web clients compare against it to swap an
-- optimistic bubble for the confirmed row. A Discord snowflake is not that. It
-- is an identifier issued by a foreign system, it is the join key a re-run
-- importer needs, and it wants to be readable as such. Overloading one column
-- with both meanings makes every future reader of either path check which kind
-- of value it is holding, and makes the composer's key namespace collide with a
-- namespace it does not control.
--
-- The cost of separating them is exactly this file. The cost of not separating
-- them grows with every consumer of `client_message_id`.
--
-- WHAT HAPPENS TO THE OLD INDEX
--
-- `idx_chat_messages_dedupe` keeps its NULLS NOT DISTINCT clause and is NOT
-- rebuilt. The clause is now inert -- imported rows no longer set
-- `client_message_id`, and live rows always carry a sender -- but dropping and
-- recreating a unique index on the product's hot insert path opens a real window
-- with no idempotency protection on live sends, and it would buy nothing. What
-- was wrong was the *prose*, not the index: the step-4 comment in
-- 20260823120000, the DB_PROMOTION_RUNBOOK entry for it, and ADR-03 all state
-- that the importer writes the snowflake into `client_message_id`. Those are
-- corrected alongside this migration (the ADR by amendment, since ADRs are
-- immutable). This header is the superseding record for the migration comment,
-- which is already promoted and is not edited in place.
--
-- WHAT THIS ALSO SUPERSEDES IN 20260823124000 (the chat-archive bucket)
--
-- That migration's header states "WRITE PATH: SERVER-SIDE, NOT A SIGNED UPLOAD
-- URL -- Nothing user-controlled is ever stored here. The importer fetches each
-- Discord CDN object itself", and concludes that `allowed_mime_types` is
-- therefore "a second belt rather than the only one". Both halves are now
-- wrong, and the second one is a security claim, so it is corrected here rather
-- than left to mislead whoever next trims that list:
--
--   * The importer never contacts Discord. The admin runs DiscordChatExporter
--     with `--media` on their own machine and their BROWSER uploads each file
--     through a signed URL, so the bytes are user-supplied and never pass
--     through the API.
--   * `allowed_mime_types` is consequently the ENFORCEMENT POINT on that
--     bucket, not a second belt. It does enforce -- a signed-URL PUT of a type
--     outside the list answers 415 `invalid_mime_type` from storage-api,
--     measured against a live stack -- and the API's extension-derived
--     pre-check exists to turn that into a readable error, not to replace it.
--     Do not relax that list on the belief that something server-side is
--     resolving types behind it.
--   * The object layout there (`.../{channel_id}/{message_id}/{basename}`)
--     assumed Signet ids exist at write time. They do not; see
--     `archiveImportPrefix()` in apps/api/src/domain/constants/storage.ts for
--     the import-scoped layout that shipped.
--
-- Every statement is guarded, so the file is re-runnable (`db push --local` is
-- treated as idempotent -- AGENTS.md § Gotchas).

-- ---------------------------------------------------------------------------
-- 1. The foreign identity.
--
-- Nullable with no default: only imported rows carry one, so this is
-- catalog-only on a table whose hot path is INSERT -- no rewrite, no backfill,
-- no write amplification on an ordinary send.
alter table public.chat_messages
  add column if not exists external_message_id text;

-- ---------------------------------------------------------------------------
-- 2. The importer's dedupe key.
--
-- Scoped to the channel, not the chapter: `chat_messages` has no `chapter_id`,
-- and a channel already resolves to exactly one chapter. Scoped per channel
-- rather than globally because the same Discord message can legitimately land in
-- two Signet channels if an operator imports one export twice with different
-- channel mappings -- that is a deliberate operator choice, not a duplicate.
--
-- Re-running the same import against the same mapping is what this rejects, and
-- it is the whole idempotency story. The importer does NOT upsert past it:
-- PostgREST cannot use a PARTIAL unique index as an ON CONFLICT arbiter
-- (`ignoreDuplicates` still answers 409, and naming the arbiter explicitly
-- answers 42P10, because Postgres needs the index predicate restated and
-- PostgREST has no syntax for it -- both measured against a live stack). So the
-- importer reads which snowflakes already exist and inserts only the rest, and
-- this index is the backstop that makes that check-then-act safe.
--
-- On NULLS NOT DISTINCT: it is spelled here for symmetry with
-- `idx_chat_messages_dedupe`, but unlike there it is INERT. `channel_id` is NOT
-- NULL and the partial predicate already excludes a null `external_message_id`,
-- so neither key column can be null inside this index. It is not load-bearing;
-- do not cite this index as precedent for the clause mattering.
create unique index if not exists idx_chat_messages_external_dedupe
  on public.chat_messages (channel_id, external_message_id)
  nulls not distinct
  where external_message_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Which import a row came from.
--
-- Rides in the existing `metadata` jsonb rather than taking a column: it is
-- read by exactly one query (the purge) and by nothing on the hot path, and
-- `chat_messages` does not need another nullable column that only imported rows
-- populate.
--
-- It is what makes the purge exact. Two imports may both merge into one live
-- channel; without this, "delete the messages belonging to import X" is not
-- answerable and the purge would take the other import's history with it.
--
-- Partial, on the expression, because it only ever serves imported rows.
--
-- The predicate is `kind = 'imported'` and NOT `metadata ? 'discord_import_id'`,
-- which is the obvious spelling and does not work. To use a partial index
-- Postgres must PROVE the query's WHERE implies the index predicate, and it
-- cannot derive `metadata ? 'discord_import_id'` from
-- `metadata ->> 'discord_import_id' = $1` — `->>` yielding a value is not, to
-- the proof machinery, the same claim as `?` reporting the key present.
--
-- Measured, not reasoned about: with the `?` predicate the purge query would not
-- use this index even with `enable_seqscan = off` — it is unreachable, not
-- merely unattractive. With `kind = 'imported'`, which the purge query states
-- literally, the planner picks a bitmap index scan unprompted at 200k rows.
-- Either way the index stays off the live insert path, which is the point.
create index if not exists idx_chat_messages_discord_import
  on public.chat_messages ((metadata ->> 'discord_import_id'))
  where kind = 'imported';

-- ---------------------------------------------------------------------------
-- 4. The import job.
--
-- One row per import attempt. The admin creates it, uploads an export against
-- it, maps its channels and roles, starts it, and can purge it. It is also the
-- lease: `claimed_at` / `claimed_by` are what stop two API replicas (or a
-- restart racing its own previous run) from importing the same export twice.
-- That mirrors `scheduled_notification_dispatches` -- a `@Cron` handler fires on
-- every replica, so multi-instance safety comes from a database claim rather
-- than from deployment topology (docs/internal/ops/DEPLOYMENT.md §5.6).
create table if not exists public.discord_imports (
  id           uuid primary key default gen_random_uuid(),
  chapter_id   uuid not null references public.chapters(id) on delete cascade,
  -- Who started it. No ON DELETE clause would block account deletion, and
  -- SET NULL loses the actor; the chapter audit row carries the durable record,
  -- so this may go null when the user is anonymised.
  created_by   uuid references public.users(id) on delete set null,
  status       text not null default 'draft',
  guild_id     text,
  guild_name   text,
  -- NOT NULL on purpose. The compliance step (the admin confirming they posted
  -- an in-channel notice to their Discord server) is a deliberate friction
  -- point, and a friction point that lives only in the web wizard is not one --
  -- a caller hitting the API directly would skip it. A row cannot exist without
  -- the acknowledgement, so there is no import anywhere in the system that was
  -- not preceded by it.
  consent_acknowledged_at timestamptz not null,
  -- Discord role -> Signet permission-set mapping, informational only. It
  -- records what the admin intends for future MANUAL promotion; nothing reads it
  -- to grant a permission, and the importer never assigns a role. Shape:
  --   [{ "discord_role_id": "...", "discord_role_name": "...", "signet_role": "member" }]
  role_mapping jsonb not null default '[]'::jsonb,
  -- Bucket-relative prefix holding this import's uploaded export, so the purge
  -- can sweep storage without reconstructing the path from parts.
  storage_prefix     text,
  total_messages     integer not null default 0,
  imported_messages  integer not null default 0,
  error              text,
  -- The lease, compare-and-swap style. `@Cron` fires on every replica and
  -- @nestjs/schedule does not stop a handler re-entering while the previous run
  -- is still in flight, so the claim is `update ... where lock_token is not
  -- distinct from <the token we read>`: a worker whose lease expired and whose
  -- job was re-claimed elsewhere updates zero rows, notices, and stops. A bare
  -- `claimed_at < now() - interval` check cannot do that -- it tells the loser
  -- it lost only if it happens to re-read.
  lock_token       uuid,
  locked_by        text,
  lease_expires_at timestamptz,
  attempt_count    integer not null default 0,
  -- Resume point, in (part, message-within-part). An optimisation, not the
  -- correctness mechanism: `idx_chat_messages_external_dedupe` is what makes a
  -- replayed batch a no-op. A stale cursor costs a redundant read, never a
  -- duplicate row.
  cursor_part_index         integer not null default 0,
  cursor_message_index      integer not null default 0,
  cursor_part_message_count integer not null default 0,
  parts_total               integer not null default 0,
  messages_skipped     integer not null default 0,
  attachments_imported integer not null default 0,
  attachments_skipped  integer not null default 0,
  -- Per-run warnings the admin can read (an unmapped channel, a media reference
  -- with no uploaded file). Bounded in the service to the most recent 50 so a
  -- pathological export cannot grow this row without limit.
  warnings jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  purged_at    timestamptz,
  constraint discord_imports_status_check check (
    status in ('draft', 'ready', 'running', 'completed', 'failed',
               'cancelled', 'purging', 'purged')
  ),
  constraint discord_imports_counts_nonneg check (
    total_messages >= 0 and imported_messages >= 0
      and messages_skipped >= 0 and attachments_imported >= 0
      and attachments_skipped >= 0 and parts_total >= 0
      and cursor_part_index >= 0 and cursor_message_index >= 0
      and cursor_part_message_count >= 0
  )
);

-- The list view is per chapter, newest first.
create index if not exists idx_discord_imports_chapter
  on public.discord_imports (chapter_id, created_at desc);

-- The worker's pickup query: the runnable states only. Partial, so the index
-- stays tiny no matter how much import history a chapter accumulates.
create index if not exists idx_discord_imports_runnable
  on public.discord_imports (status, lease_expires_at)
  where status in ('ready', 'running', 'purging');

-- ---------------------------------------------------------------------------
-- 5. Per-channel mapping and checkpoint.
--
-- Carries two things that could have been separate tables and deliberately are
-- not: the operator's mapping decision for one Discord channel, and the
-- importer's resume position within it. They share a lifetime and are always
-- read together.
--
-- `target_channel_id` is nullable because it is unknown until the mapping step
-- runs, and ON DELETE SET NULL because deleting the Signet channel is a
-- legitimate way to undo an import -- it must not cascade the import's own
-- bookkeeping away, which is what a reader would need to explain what happened.
create table if not exists public.discord_import_channels (
  id         uuid primary key default gen_random_uuid(),
  import_id  uuid not null references public.discord_imports(id) on delete cascade,
  discord_channel_id   text not null,
  discord_channel_name text not null,
  discord_category     text,
  mapping_action text not null default 'skip',
  target_channel_id uuid references public.chat_channels(id) on delete set null,
  -- Name to give a channel this import creates. Null when merging or skipping.
  new_channel_name text,
  new_channel_is_read_only boolean not null default true,
  message_count  integer not null default 0,
  imported_count integer not null default 0,
  status text not null default 'pending',
  error  text,
  constraint discord_import_channels_unique unique (import_id, discord_channel_id),
  constraint discord_import_channels_action_check check (
    mapping_action in ('create_new', 'use_existing', 'skip')
  ),
  constraint discord_import_channels_status_check check (
    status in ('pending', 'running', 'completed', 'failed', 'skipped')
  ),
  constraint discord_import_channels_counts_nonneg check (
    message_count >= 0 and imported_count >= 0
  ),
  -- A mapping decision must name its target. Enforced here rather than in the
  -- service because the worker reads these rows directly and an unresolvable
  -- action would surface as a null-deref mid-import, thousands of rows in.
  constraint discord_import_channels_target_present check (
    (mapping_action = 'use_existing' and target_channel_id is not null)
    or (mapping_action = 'create_new' and new_channel_name is not null)
    or mapping_action = 'skip'
  )
);

create index if not exists idx_discord_import_channels_import
  on public.discord_import_channels (import_id);

-- ---------------------------------------------------------------------------
-- 6. The upload manifest -- and the only join from the export back to storage.
--
-- This is the table that makes the import work at all, and it is not obvious
-- why, so: DiscordChatExporter run with `--media` rewrites every asset URL in
-- the JSON to a path RELATIVE TO THE EXPORT FOLDER on the admin's machine
-- (`ResolveAssetUrlAsync`). So `attachments[].url` reads something like
-- `Guild - general [123]_Files/photo-a1b2c3.png`, and `author.avatarUrl` the
-- same. Those strings mean nothing to us. The browser uploads each of those
-- files and records here what it called it (`relative_path`) and where it put
-- it (`storage_path`); the importer then resolves an attachment by LOOKING THE
-- STRING UP, never by rebuilding a key out of parts.
--
-- The alternative -- having the browser upload each media file to a path
-- derived from the message that references it -- was rejected: it forces the
-- client to fully parse every partition before it can upload anything, DCE
-- deduplicates identical media so one file is referenced by many messages, and
-- avatars are shared across a whole guild. A manifest costs one row per file
-- and removes all three problems.
--
-- It also makes the upload resumable. `unique (import_id, relative_path)` plus
-- a null `uploaded_at` is exactly "what still needs sending", so re-entering the
-- wizard after a failed upload re-sends the gaps rather than the archive.
create table if not exists public.discord_import_files (
  id         uuid primary key default gen_random_uuid(),
  import_id  uuid not null references public.discord_imports(id) on delete cascade,
  -- Denormalised for the same reason `chat_message_attachments.channel_id` is:
  -- tenant scope in one hop, expressible by the repository tenant-scope harness.
  -- Always derived from the import server-side, never from client input.
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  kind text not null,
  -- Order of the JSON partitions, which is the order messages are imported in
  -- and what `cursor_part_index` indexes into. Null for media.
  part_index integer,
  -- The path exactly as the export names it. The join key.
  relative_path text not null,
  bucket       text not null default 'chat-archive',
  storage_path text not null,
  content_type text,
  byte_size    bigint,
  -- Null until the browser confirms the PUT landed.
  uploaded_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint discord_import_files_kind_check check (kind in ('export', 'media')),
  constraint discord_import_files_size_nonneg check (byte_size is null or byte_size >= 0),
  constraint discord_import_files_relpath_unique unique (import_id, relative_path)
);

-- The worker walks the export parts in order; the resolver looks media up by
-- relative_path within one import. Both are served by this.
create index if not exists idx_discord_import_files_import
  on public.discord_import_files (import_id, kind, part_index);

-- ---------------------------------------------------------------------------
-- 7. Default-deny RLS on all three (Frapp's invariant: every public table enables
-- RLS). No policies, matching `chat_channels`, `chat_messages`' write paths and
-- `chat_message_attachments`: the API reads these on the service-role key, which
-- bypasses RLS, and a policy here would open a direct-PostgREST surface nothing
-- needs.
alter table public.discord_imports enable row level security;
alter table public.discord_import_channels enable row level security;
alter table public.discord_import_files enable row level security;
