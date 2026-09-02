-- Widen scheduled_notification_dispatches for pre-event reminders (#391).
--
-- `entity_type` already accepts 'EVENT' — the auto-absent sweep claims under
-- it — so only `threshold` widens here. The reminder claims a *different*
-- threshold on the same entity type, which is what lets one event carry both
-- a pre-start reminder and a post-grace auto-absent claim without either
-- suppressing the other.
--
-- Purely additive: the constraint gains a value and rejects nothing it
-- previously accepted, so no existing row can violate it and there is no
-- backfill or rollback data-loss risk. See
-- 20260805140000_scheduled_notification_dispatches.sql for why the claim
-- exists at all (multi-replica idempotency, not just bookkeeping).
alter table scheduled_notification_dispatches
  drop constraint if exists scheduled_notification_dispatches_threshold_check;
alter table scheduled_notification_dispatches
  add constraint scheduled_notification_dispatches_threshold_check
  check (
    threshold in ('DUE_SOON', 'OVERDUE', 'AUTO_ABSENT', 'EXPIRED', 'EVENT_REMINDER')
  );

-- No index is added here on purpose. The reminder sweep filters `events` on a
-- bounded `start_time` window every five minutes, and `idx_events_start_time`
-- already covers that — it has existed since
-- 00000000000000_initial_schema.sql. (The auto-absent sweep needed
-- `idx_events_end_time` added in 20260805140000 precisely because `end_time`,
-- unlike `start_time`, had none.) A `create index if not exists` here would be
-- dead SQL that reads like the sweep's index lives in this migration.
