-- Chat attachments become rows instead of text in the message body.
--
-- THE BUG THIS FIXES, WHICH IS A LIVE-CHAT BUG, NOT AN IMPORT ONE
--
-- `apps/web/components/chat/composer.tsx` uploads an attachment to the `chat`
-- bucket and then appends `\n📎 <filename> (<storagePath>)` into the Tiptap
-- document, so the storage path survives only as a substring of
-- `chat_messages.content`. Nothing links the object to the message: the message
-- cannot be rendered with a thumbnail, the attachment cannot be listed, deleting
-- the message cannot clean up the object, and a member can edit the sigil out of
-- their own body and orphan the file. The Discord import needs a real attachment
-- model and so does live chat -- same bug, one fix.
--
-- WHY channel_id IS DENORMALISED HERE
--
-- `chat_messages` has no `chapter_id`; chapter scope is reached through
-- `channel_id -> chat_channels.chapter_id` (see 20260523150000_chat_hotpath.sql).
-- Carrying `message_id` alone would make this table's tenant scope a TWO-hop
-- resolution (attachment -> message -> channel -> chapter), which the repository
-- tenant-scope harness cannot express and which every read would have to spell as
-- a nested PostgREST embed. Carrying `channel_id` too makes it exactly one hop,
-- identical to `chat_messages` itself. The column is set from the message row by
-- the service, never from client input.
--
-- WHY NO RLS POLICY
--
-- Default deny, matching `chat_channels` and every other chat table that is not a
-- Realtime carrier. This table is not in the `supabase_realtime` publication and
-- is read only by the API on the service-role key, so a permissive policy would
-- open a direct-PostgREST read surface that nothing needs. `chat_messages` has a
-- SELECT policy only because Realtime enforces RLS per subscriber; there is no
-- such requirement here.

-- ---------------------------------------------------------------------------
-- 1. The table.
create table if not exists public.chat_message_attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.chat_messages(id) on delete cascade,
  channel_id   uuid not null references public.chat_channels(id) on delete cascade,
  bucket       text not null,
  storage_path text not null,
  filename     text not null,
  -- Nullable: the legacy backfill in step 4 recovers a path and a filename from
  -- prose and can only infer a content type from the extension. A row whose type
  -- could not be inferred says so rather than asserting application/octet-stream.
  content_type text,
  -- Nullable for the same reason -- the byte size is not recoverable from the
  -- message body, only from a storage HEAD, which a migration must not do.
  byte_size    bigint,
  width        integer,
  height       integer,
  -- The original Discord CDN url, kept for imported attachments so a failed or
  -- partial media fetch can be retried without re-reading the export.
  external_url text,
  created_at   timestamptz not null default now(),
  constraint chat_message_attachments_byte_size_nonneg
    check (byte_size is null or byte_size >= 0),
  constraint chat_message_attachments_dims_nonneg
    check ((width is null or width >= 0) and (height is null or height >= 0)),
  -- One row per object PER MESSAGE. Scoped to the message on purpose: the sigil
  -- this migration backfills was plain editable text, so a member quoting or
  -- copy-pasting another message's body produced a second message naming the
  -- same object. A `(bucket, storage_path)` key would insert a row for the first
  -- and silently skip the second, while step 4 stripped the sigil out of both —
  -- leaving that member's message with neither the text nor a row, and nothing
  -- in the rollback able to reconstruct it.
  --
  -- This is still what makes the write idempotent: a retry re-claims the same
  -- object for the same message, which is a no-op.
  constraint chat_message_attachments_object_unique
    unique (message_id, bucket, storage_path)
);

-- The per-message fetch is the only hot read: the message list resolves
-- attachments for a page of messages at a time.
create index if not exists idx_chat_message_attachments_message
  on public.chat_message_attachments (message_id);

-- Tenant-scoped sweeps (retention, chapter deletion, orphan audits) lead with
-- the channel, which the message index cannot serve.
create index if not exists idx_chat_message_attachments_channel
  on public.chat_message_attachments (channel_id);

-- ---------------------------------------------------------------------------
-- 2. Default-deny RLS (Frapp's invariant: every public table enables RLS).
alter table public.chat_message_attachments enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Backfill the legacy sigils into real rows.
--
-- The pattern the composer wrote is `📎 <name> (<storagePath>)`. The path group is
-- anchored on `chapters/<uuid>/chat/` so a member who happened to type that shape
-- by hand is not matched -- a false positive here would delete text out of
-- somebody's message, so the predicate is deliberately narrow rather than
-- forgiving. `.+?` is lazy so a filename containing ` (` does not swallow the path.
--
-- `regexp_matches(..., 'g')` handles messages carrying more than one attachment.
-- `on conflict do nothing` on the object-unique constraint makes the whole step
-- re-runnable.
insert into public.chat_message_attachments
  (message_id, channel_id, bucket, storage_path, filename, content_type)
select
  m.id,
  m.channel_id,
  'chat',
  hit[2],
  hit[1],
  case lower(regexp_replace(hit[1], '^.*\.', ''))
    when 'jpg'  then 'image/jpeg'
    when 'jpeg' then 'image/jpeg'
    when 'png'  then 'image/png'
    when 'gif'  then 'image/gif'
    when 'webp' then 'image/webp'
    when 'pdf'  then 'application/pdf'
    when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    when 'pptx' then 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    when 'doc'  then 'application/msword'
    when 'xls'  then 'application/vnd.ms-excel'
    when 'ppt'  then 'application/vnd.ms-powerpoint'
    when 'txt'  then 'text/plain'
    when 'csv'  then 'text/csv'
    else null
  end
from public.chat_messages m
cross join lateral regexp_matches(
  m.content,
  -- The path group ends in a BACKREFERENCE to the captured filename (`\1`), and
  -- that is what makes this exact rather than approximate. Two independent
  -- things defeat the obvious spellings:
  --
  --   * `)` inside the filename. Storage keys end in `path.basename(filename)`
  --     verbatim, so `Budget (2025).xlsx` puts a `)` inside the key. A `[^)]*`
  --     path group cuts it off at `.../Budget (2025`, writes a row pointing at
  --     an object that does not exist, and the strip below then rewrites the
  --     body around the truncation and leaves `.xlsx)` behind.
  --
  --   * Text after the sigil. The old composer called `insertContent` at the
  --     cursor and left the caret after the `)`, so a member could type a
  --     caption: `…minutes.pdf) — signed copy`. Anchoring the match on the end
  --     of the line skips that message entirely — no row, no strip, orphaned
  --     object, which is the state this migration exists to remove.
  --
  -- The backreference satisfies both: the path must END with the same filename
  -- the sigil announced, so the closing `)` is located exactly, wherever it is
  -- on the line. A backreference matches literal text, so a filename containing
  -- regex metacharacters is safe. `[^\n]` rather than `.` because Postgres regex
  -- `.` matches a newline, which would let one match swallow the next sigil.
  '📎 ([^\n]+?) \((chapters/[0-9a-fA-F-]{36}/chat/[^\n]*?\1)\)',
  'g'
) as hit
on conflict on constraint chat_message_attachments_object_unique do nothing;

-- ---------------------------------------------------------------------------
-- 4. Strip the sigils now that the data is modelled.
--
-- This rewrites message bodies, which is why it is reversible by construction:
-- the filename and the storage path both survive in the rows written above, so
-- the pre-migration `content` can be reconstructed by re-appending them. See
-- DB_ROLLBACK_PLAYBOOK.md.
--
-- Scoped to rows that actually matched, so a re-run is a no-op and no unrelated
-- message is touched by the trim.
--
-- `metadata.attachment_count` is stamped in the same statement. It is a COUNT,
-- not a copy of the data: the rows above stay the only source of truth. It exists
-- because a `postgres_changes` echo of a `chat_messages` row cannot carry a join,
-- so without it a client receiving a live message has no way to know it should ask
-- for attachments -- and a message that is nothing but a file would render as an
-- empty bubble. The renderer has to call the API for these anyway, because every
-- bucket is private and a download URL has to be signed per request.
update public.chat_messages m
set content = btrim(
      regexp_replace(
        m.content,
        '[[:space:]]*📎 ([^\n]+?) \(chapters/[0-9a-fA-F-]{36}/chat/[^\n]*?\1\)',
        '',
        'g'
      )
    ),
    metadata = coalesce(m.metadata, '{}'::jsonb)
      || jsonb_build_object(
           'attachment_count',
           (select count(*) from public.chat_message_attachments a where a.message_id = m.id)
         )
where m.content ~ '📎 ([^\n]+?) \(chapters/[0-9a-fA-F-]{36}/chat/[^\n]*?\1\)'
  -- Belt and braces on top of the per-message unique key above: never remove the
  -- only reference a message has to its file. If step 3 did not produce a row
  -- for this message, the prose stays — visibly stale beats silently gone.
  and exists (
    select 1 from public.chat_message_attachments a where a.message_id = m.id
  );
