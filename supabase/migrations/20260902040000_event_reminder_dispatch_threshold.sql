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

-- Supporting index for the reminder sweep, which filters `events` on a
-- bounded `start_time` window every five minutes.
-- 20260805140000_scheduled_notification_dispatches.sql added
-- `idx_events_end_time` for the auto-absent sweep on exactly these grounds;
-- the reminder sweep reads the other end of the event and needs its own, or
-- every tick sequentially scans the whole events table.
create index if not exists idx_events_start_time on events (start_time);
