/**
 * Display formatting for s10. Every value here is derived from a server
 * timestamp; none of it is credited time in its own right (`lib/study/session.ts`
 * owns that distinction).
 */

import { localWeekStart } from "@repo/hooks";

/** Minutes as the drawn `2.1 hrs`. Singular below 1.05 so `1.0 hrs` never ships. */
export function formatHoursLabel(minutes: number): string {
  const hours = Math.max(0, minutes) / 60;
  const rounded = hours.toFixed(1);
  return `${rounded} ${rounded === "1.0" ? "hr" : "hrs"}`;
}

/** Minutes as a bare one-decimal hour count, for the week summary's big number. */
export function formatHoursValue(minutes: number): string {
  return (Math.max(0, minutes) / 60).toFixed(1);
}

/**
 * Midnight local at the start of the member's current week (Sunday), for the
 * THIS WEEK bucket.
 *
 * Local, not UTC: a member studying at 9pm Sunday in New York is in a different
 * UTC week than the one their calendar shows, and the bucket has to match the
 * calendar they are looking at. This is the same class of defect C3 fixed in
 * `isDueUrgent`, approached from the other direction.
 */
export function startOfWeek(now: Date): Date {
  // The one definition, which Activity's "Study hours, This week" also sends
  // to the server, so the two screens never count different weeks.
  return localWeekStart(now);
}
