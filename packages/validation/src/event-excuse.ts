/**
 * Absence excuses for required events (`spec/behavior/events.md` § Excuses,
 * #3735). One copy for every surface: the API enforces these, and the apps
 * read them only to stop offering what the server would refuse.
 */

/**
 * How long after an event ends a member may still send an excuse: long enough
 * for "I was sick that morning" to arrive the next day. Picked in #3735 and
 * open to the owner's review.
 */
export const EVENT_EXCUSE_LATE_HOURS = 48;

/** The longest reason a member may write. The column checks the same. */
export const EVENT_EXCUSE_REASON_MAX = 500;

export const EVENT_EXCUSE_STATUSES = [
  "PENDING",
  "APPROVED",
  "DECLINED",
] as const;
export type EventExcuseStatus = (typeof EVENT_EXCUSE_STATUSES)[number];

/** The last instant an excuse for an event ending at `end` is accepted. */
export function eventExcuseClosesAt(end: Date): Date {
  return new Date(end.getTime() + EVENT_EXCUSE_LATE_HOURS * 60 * 60 * 1000);
}
