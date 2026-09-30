-- A report keeps the reported message's attachments while it is open (#2481).
--
-- A report snapshots what the member wrote (`reported_content`), so a sender
-- who deletes their own message cannot blank the evidence. Attachments had no
-- such copy: the delete purged the storage objects, and a reported photo with
-- no caption left the officer queue an empty snapshot and nothing to review.
-- The owner chose (2026-09-30) to keep the files while a report is open and
-- purge them when it resolves.
--
--   reported_attachments  one {bucket, storage_path, filename, content_type,
--                         byte_size} per attachment on the message when the
--                         report was filed. The API writes it from the
--                         message's chat_message_attachments rows. Until the
--                         report's release finishes, every purge (a message
--                         delete, a Discord import's deletion) keeps the
--                         objects it names; while it is open, the officer
--                         queue can sign them.
--   evidence_released_at  when the API last finished releasing a resolved
--                         report's objects: deleting each one no undeleted
--                         message and no other report still holds. NULL on an
--                         open report, and on a resolved one whose release has
--                         not finished (a Storage outage, say), which is what
--                         the hourly sweep looks for. It is what ends a hold,
--                         not the status: a removal claims its report before
--                         deleting the message, and a claim withdrawn back to
--                         open (which clears the stamp) must not find its
--                         evidence purged in between.
--
-- A jsonb array on the report row rather than a child table, because the
-- snapshot is written once, with the report, and read whole. Not null with a
-- default of '[]', so every existing report reads as holding nothing: reports
-- filed before this migration never snapshotted their attachments, and nothing
-- backfills them. The CHECK keeps the one shape the API reads.
--
-- Two partial indexes, each as small as what it serves:
--   idx_chat_message_reports_evidence_held       the hold lookup ("which
--     objects do this chapter's unreleased reports name"), paged by id.
--   idx_chat_message_reports_evidence_unreleased the sweep's read: resolved,
--     unreleased reports, oldest resolution first.
--
-- No policy changes. The table keeps RLS on with zero policies
-- (20260915210000): only the API's service-role client reads it.

alter table public.chat_message_reports
  add column if not exists reported_attachments jsonb not null default '[]'::jsonb
    constraint chat_message_reports_attachments_array
      check (jsonb_typeof(reported_attachments) = 'array'),
  add column if not exists evidence_released_at timestamptz;

create index if not exists idx_chat_message_reports_evidence_held
  on public.chat_message_reports (chapter_id, id)
  where evidence_released_at is null
    and reported_attachments <> '[]'::jsonb;

create index if not exists idx_chat_message_reports_evidence_unreleased
  on public.chat_message_reports (resolved_at)
  where status <> 'open'
    and evidence_released_at is null
    and reported_attachments <> '[]'::jsonb;
