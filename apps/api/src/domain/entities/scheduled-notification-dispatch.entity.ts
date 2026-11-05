/**
 * Delivery bookkeeping for the scheduled-reminder sweeps, persisted to
 * `scheduled_notification_dispatches` (`20260805140000_…dispatches.sql`).
 *
 * One row per `(entity_type, entity_id, threshold, due_date)` — the unique
 * constraint is the dedup mechanism, so a losing insert raises `23505` and is
 * treated as "already dispatched", not as an error.
 *
 * This table is API-only (service role): members read the resulting reminders
 * from `notifications`, never this.
 */

/** Entity families the dispatch log dedups. */
export type DispatchEntityType = 'INVOICE' | 'TASK' | 'EVENT' | 'POLL';

/** Work thresholds, one dispatch row per (entity, threshold, due date). */
export type DispatchThreshold =
  'DUE_SOON' | 'OVERDUE' | 'AUTO_ABSENT' | 'EXPIRED' | 'EVENT_REMINDER';

/**
 * The reminder sweep a dispatch belongs to, as an identifier-shaped id
 * (`invoice.due-soon`, `event.event-reminder`). The claim, release and
 * delivery helpers every sweep shares report their failures under it, so one
 * sweep failing is one Sentry issue, apart from the others.
 */
export function dispatchSweepId(
  entityType: DispatchEntityType,
  threshold: DispatchThreshold,
): string {
  const kebab = (value: string) => value.toLowerCase().replace(/_/g, '-');
  return `${kebab(entityType)}.${kebab(threshold)}`;
}

export interface ScheduledNotificationDispatch {
  id: string;
  chapter_id: string;
  entity_type: DispatchEntityType;
  entity_id: string;
  threshold: DispatchThreshold;
  /** Date-only (`date` column), so `YYYY-MM-DD` rather than a timestamp. */
  due_date: string;
  dispatched_at: string;
}
