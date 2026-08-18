/**
 * Display formatting for s10. Every value here is derived from a server
 * timestamp; none of it is credited time in its own right (`lib/study/session.ts`
 * owns that distinction).
 */

/**
 * Seconds as a stopwatch: `1:24:36` past the hour, `4:12` below it.
 *
 * Canvas draws only the over-an-hour case. Padding a short session to `0:04:12`
 * would put a zero on screen that means nothing to the member, so the hour
 * segment is dropped rather than zero-filled — the ordinary stopwatch reading.
 */
export function formatTimer(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

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

function timeOfDay(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function weekday(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

/**
 * A history row's meta line: `Tue · 7:02 – 9:10 PM`.
 *
 * The range separator is an en dash, as drawn. An open-ended session (no
 * `end_time`, which a terminal row should never have but the API does not
 * promise) degrades to the start alone rather than rendering a dangling dash.
 *
 * These are full ISO instants, not bare `YYYY-MM-DD`, so the noon-UTC parse
 * `lib/more/service-hours.ts` needs does not apply — a timestamp already carries
 * its offset and `new Date` reads it correctly in every zone.
 */
export function formatSessionRange(
  startTime: string,
  endTime: string | null,
): string | null {
  const day = weekday(startTime);
  const from = timeOfDay(startTime);
  if (!day || !from) return null;
  const to = endTime ? timeOfDay(endTime) : null;
  return to ? `${day} · ${from} – ${to}` : `${day} · ${from}`;
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
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
  );
  start.setDate(start.getDate() - start.getDay());
  return start;
}
