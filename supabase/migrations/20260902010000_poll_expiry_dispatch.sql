-- Widen scheduled_notification_dispatches for poll-expiry notices (#404).
--
-- The table's entity_type/threshold CHECK constraints were scoped to the
-- three sweeps that existed when it was created (INVOICE/TASK due-soon and
-- overdue, EVENT auto-absent). The poll-expiry sweep needs its own entity
-- type ('POLL') and threshold ('EXPIRED') to claim a dispatch the same way —
-- see 20260805140000_scheduled_notification_dispatches.sql for why the claim
-- exists at all (multi-replica idempotency, not just bookkeeping).
--
-- Purely additive: existing rows and existing entity_type/threshold values
-- are untouched, so no backfill and no rollback data-loss risk.
alter table scheduled_notification_dispatches
  drop constraint scheduled_notification_dispatches_entity_type_check;
alter table scheduled_notification_dispatches
  add constraint scheduled_notification_dispatches_entity_type_check
  check (entity_type in ('INVOICE', 'TASK', 'EVENT', 'POLL'));

alter table scheduled_notification_dispatches
  drop constraint scheduled_notification_dispatches_threshold_check;
alter table scheduled_notification_dispatches
  add constraint scheduled_notification_dispatches_threshold_check
  check (threshold in ('DUE_SOON', 'OVERDUE', 'AUTO_ABSENT', 'EXPIRED'));

-- Supporting index for the sweep query: chat_messages has no column for
-- expires_at (it lives in the metadata jsonb), so this indexes the JSON path
-- the same way the existing poll list/active-filter queries read it
-- (supabase-chat-message.repository.ts's findPollsByChapter).
create index idx_chat_messages_poll_expires_at
  on chat_messages ((metadata ->> 'expires_at'))
  where type = 'POLL';
