/**
 * The start of the member's week on this device: last Sunday at local
 * midnight. The one definition, so every screen that says "This week"
 * (Activity's week card and recap, the phone's Study screen and More row,
 * the Meetings and Minutes lists) counts the same week.
 */
export function localWeekStart(now: Date = new Date()): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - start.getDay());
  return start;
}
