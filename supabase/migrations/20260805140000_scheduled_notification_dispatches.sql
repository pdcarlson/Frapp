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
-- Attendance auto-absent claims a row too, under entity_type 'EVENT'. It does
-- not strictly need one for correctness — `markAutoAbsent` is idempotent by
-- construction, since it skips members who already have an attendance record
-- — but without a claim every replica re-runs it on all 24 hourly ticks
-- inside the lookback window. Those redundant passes each cost four reads per
-- event and, on more than one replica, race on `event_attendance`'s
-- unique (event_id, user_id) constraint, so all but one instance logs a
-- failure every hour for every mandatory event. The claim makes it run once.

-- `due_date` participates in the unique key on purpose. Keying only on
-- (entity, threshold) would make the claim outlive the deadline it describes:
-- an admin who extends an invoice's `due_date` after it already went overdue
-- would find the extended invoice silently un-notifiable forever, because the
-- old claim still wins. Including the date a claim was made *about* means a
-- rescheduled entity earns a fresh claim, while re-running a sweep against an
-- unchanged deadline still dedups exactly as before.
create table scheduled_notification_dispatches (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  entity_type text not null check (entity_type in ('INVOICE', 'TASK', 'EVENT')),
  entity_id uuid not null,
  threshold text not null
    check (threshold in ('DUE_SOON', 'OVERDUE', 'AUTO_ABSENT')),
  due_date date not null,
  dispatched_at timestamptz not null default now(),
  unique (entity_type, entity_id, threshold, due_date)
);

create index idx_scheduled_notification_dispatches_chapter
  on scheduled_notification_dispatches (chapter_id);

-- Supporting indexes for the sweep queries. Each sweep filters globally on a
-- bounded date window, which without these degrades to a sequential scan of
-- the whole table on every tick — cheap today, but the bounded windows are
-- documented as the thing keeping these queries indexed, so make that true.
create index idx_events_end_time on events (end_time);
create index idx_financial_invoices_status_due_date
  on financial_invoices (status, due_date);
create index idx_tasks_status_due_date on tasks (status, due_date);

alter table scheduled_notification_dispatches enable row level security;

-- No client policies: this table is API-only (service role), like
-- `chapter_directory_requests`. It holds delivery bookkeeping, not
-- member-visible data — members read the resulting reminders from
-- `notifications`, which has its own policies.
