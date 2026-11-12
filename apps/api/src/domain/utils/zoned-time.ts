/**
 * Wall-clock time in a named time zone, to and from an instant.
 *
 * The acting agent (#718) reads "Friday at 7" from an officer in their own
 * zone and has to store the instant. `Intl` only goes the other way (an
 * instant to wall-clock parts), so the instant is found by asking what the
 * zone's offset is around the guess and correcting, twice: the second pass
 * settles a guess that landed on the other side of a daylight-saving change.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{1,2}):(\d{2})$/;

function partsIn(instant: Date, timeZone: string): Record<string, number> {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const parts: Record<string, number> = {};
  for (const part of formatted) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts;
}

/** How far the zone's wall clock is ahead of UTC at `instant`, in ms. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** A real calendar date written `YYYY-MM-DD`, or null. */
export function parseLocalDate(
  value: unknown,
): { year: number; month: number; day: number } | null {
  if (typeof value !== 'string') return null;
  const match = DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
    ? { year, month, day }
    : null;
}

/** A 24-hour time written `H:MM` or `HH:MM`, or null. */
export function parseLocalTime(
  value: unknown,
): { hour: number; minute: number } | null {
  if (typeof value !== 'string') return null;
  const match = TIME.exec(value.trim());
  if (!match) return null;
  const [hour, minute] = [Number(match[1]), Number(match[2])];
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

/**
 * The instant at which a clock in `timeZone` reads `date` `time`. Null when
 * either is not a real date or time. A time that does not exist that day
 * (the hour skipped in spring) lands on the hour after it.
 */
export function zonedTimeToUtc(
  date: string,
  time: string,
  timeZone: string,
): Date | null {
  const d = parseLocalDate(date);
  const t = parseLocalTime(time);
  if (!d || !t) return null;
  const wall = Date.UTC(d.year, d.month - 1, d.day, t.hour, t.minute);
  let instant = new Date(wall - offsetMs(new Date(wall), timeZone));
  instant = new Date(wall - offsetMs(instant, timeZone));
  return instant;
}

/** The calendar date a clock in `timeZone` shows at `instant`, `YYYY-MM-DD`. */
export function localDateIn(instant: Date, timeZone: string): string {
  const p = partsIn(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
