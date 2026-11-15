/**
 * What a wall clock in one time zone reads at an instant: the shared helper
 * for the sweeps that act at a local hour of each member's day (the birthday
 * post, #4959; the daily task and invoice reminders, #4788; the weekly recap
 * push, #4985).
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

/** How far `timeZone`'s wall clock runs ahead of UTC at `at`, in ms. */
function zoneOffsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const part = (type: string) =>
    Number(parts.find((entry) => entry.type === type)?.value);
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return wall - Math.floor(at / 1000) * 1000;
}

/**
 * The instant a calendar day begins in `timeZone`: its local midnight, for
 * the weekly recap push's week (#4985). The offset is read at the guess and
 * again at the answer, so a day whose clock changed later on (the US moves
 * at 2 AM) still begins at its own midnight. `month` is 1-based, and a `day`
 * past the month's end rolls over as `Date.UTC` does. Throws on a bad zone,
 * as `Intl` does; {@link localClock} is the caller's check.
 */
export function localMidnight(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(year, month - 1, day);
  const guess = wall - zoneOffsetMs(wall, timeZone);
  return new Date(wall - zoneOffsetMs(guess, timeZone));
}
