/**
 * What a wall clock in one time zone reads at an instant: the shared helper
 * for the sweeps that act at a local hour of each member's day (the birthday
 * post, #4959; the daily task and invoice reminders, #4788).
 */

/** The date and hour `now` reads as in `timeZone`, or null for a bad zone. */
export function localClock(
  now: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(now);
    const part = (type: string) =>
      Number(parts.find((entry) => entry.type === type)?.value);
    return {
      year: part('year'),
      month: part('month'),
      day: part('day'),
      hour: part('hour'),
    };
  } catch {
    return null;
  }
}

/** `YYYY-MM-DD` for a {@link localClock} reading. */
export function localDateKey(clock: {
  year: number;
  month: number;
  day: number;
}): string {
  return `${clock.year}-${String(clock.month).padStart(2, '0')}-${String(clock.day).padStart(2, '0')}`;
}

/** A `YYYY-MM-DD` key moved by whole calendar days. */
export function shiftDateKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
