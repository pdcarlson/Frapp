-- Scheduled notification dispatch log.
--
-- Records that a time-based reminder has already been dispatched for a given
-- entity at a given threshold, so the sweeps in `modules/scheduled-jobs` are
-- idempotent: safe to re-run, and safe to run on more than one API replica at
-- once.
--
-- The unique constraint is the concurrency control, not just a data
-- constraint. A sweep *claims* a notification by inserting here first and only
-- sends when the insert wins; a duplicate-key violation means another pass (or
-- another replica firing the same cron minute) already owns it. Without this,
-- horizontal scaling would multiply every reminder by the replica count.
--
-- Attendance auto-absent deliberately has no rows here: `markAutoAbsent` is
-- already idempotent by construction (it skips members who have an attendance
-- record), so it needs no external dedup.

create table scheduled_notification_dispatches (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  entity_type text not null check (entity_type in ('INVOICE', 'TASK')),
  entity_id uuid not null,
  threshold text not null check (threshold in ('DUE_SOON', 'OVERDUE')),
  dispatched_at timestamptz not null default now(),
  unique (entity_type, entity_id, threshold)
);

create index idx_scheduled_notification_dispatches_chapter
  on scheduled_notification_dispatches (chapter_id);

alter table scheduled_notification_dispatches enable row level security;

-- No client policies: this table is API-only (service role), like
-- `chapter_directory_requests`. It holds delivery bookkeeping, not
-- member-visible data — members read the resulting reminders from
-- `notifications`, which has its own policies.
