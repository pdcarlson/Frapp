import { describeRepeatPattern } from '@repo/validation';

/**
 * How a push names a time: what a member glancing at a lock screen needs, in
 * the shape iOS Calendar and Google Calendar use ("Mon, Nov 9, 8–9 PM").
 * `spec/behavior/notifications.md` § What a push says owns the rules.
 *
 * Rendered on the server, before the push reaches a phone, so every function
 * here takes the zone to render in. The caller resolves it per recipient
 * (`recipientTimeZone`); a recipient with no known zone gets a fallback zone
 * and a zone label, so a guessed time is never presented as theirs.
 */

/** The zone used when neither the recipient nor anyone else reported one. */
export const DEFAULT_PUSH_TIME_ZONE = 'America/New_York';

/** Separates the facts in a push body: "Required · Mon, Nov 9, 8–9 PM". */
export const PUSH_SEPARATOR = ' · ';

interface ZonedParts {
  weekday: string;
  month: string;
  day: number;
  year: number;
  hour: number;
  minute: number;
  period: 'AM' | 'PM';
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function zonedParts(at: Date, timeZone: string): ZonedParts {
  let formatter = partsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    partsFormatters.set(timeZone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(at)) parts[part.type] = part.value;
  return {
    weekday: parts.weekday,
    month: parts.month,
    day: Number(parts.day),
    year: Number(parts.year),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    period: parts.dayPeriod?.toUpperCase() === 'AM' ? 'AM' : 'PM',
  };
}

/** "8", "8:30": the minutes only when there are some, as a calendar writes it. */
function clock(parts: ZonedParts): string {
  return parts.minute === 0
    ? `${parts.hour}`
    : `${parts.hour}:${String(parts.minute).padStart(2, '0')}`;
}

function sameDay(a: ZonedParts, b: ZonedParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** "Mon, Nov 9", with the year only when it is not this year. */
function dayLabel(parts: ZonedParts, now: ZonedParts): string {
  const base = `${parts.weekday}, ${parts.month} ${parts.day}`;
  return parts.year === now.year ? base : `${base}, ${parts.year}`;
}

/** "8–9 PM", "11 AM–1 PM", "8 PM": a span on one day. */
function timeSpan(start: ZonedParts, end: ZonedParts | null): string {
  if (!end) return `${clock(start)} ${start.period}`;
  if (start.period === end.period) {
    return `${clock(start)}–${clock(end)} ${end.period}`;
  }
  return `${clock(start)} ${start.period}–${clock(end)} ${end.period}`;
}

/** "EST": the short name of `timeZone` at `at`. */
function zoneLabel(at: Date, timeZone: string): string {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? timeZone;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export interface EventWhenOptions {
  /** The zone to render in: the recipient's, or a fallback. */
  timeZone: string;
  /**
   * Append the zone's short name ("8–9 PM EST"). Set when `timeZone` is a
   * fallback rather than the recipient's own, so a guess is never silent.
   */
  labelZone?: boolean;
  /**
   * A series renders as its pattern ("Every Mon, 8–9 PM, from Nov 9"): a
   * legacy token or a structured rule (`packages/validation/src/recurrence.ts`).
   */
  recurrence?: string | null;
  /** Injected for tests; decides only whether the year is shown. */
  now?: Date;
}

/**
 * When an event happens, as a member reads it: "Mon, Nov 9, 8–9 PM",
 * "Sat, Nov 7, 6 PM – Mon, Nov 9, 12 PM" for one that spans days, and
 * "Every Mon, 8–9 PM, from Nov 9" for a series.
 */
export function formatEventWhen(
  startIso: string,
  endIso: string | null | undefined,
  options: EventWhenOptions,
): string {
  const { timeZone } = options;
  const startAt = new Date(startIso);
  const endAt = endIso ? new Date(endIso) : null;
  const start = zonedParts(startAt, timeZone);
  const end =
    endAt && endAt.getTime() > startAt.getTime()
      ? zonedParts(endAt, timeZone)
      : null;
  const now = zonedParts(options.now ?? new Date(), timeZone);
  const zone = options.labelZone ? ` ${zoneLabel(startAt, timeZone)}` : '';

  const oneDay = !end || sameDay(start, end);
  const span = oneDay ? timeSpan(start, end) : null;

  if (options.recurrence) {
    // A weekly overnight event ("Fri, 10 PM–2 AM") is still a pattern.
    const hours = timeSpan(start, end);
    const from = `${start.month} ${start.day}`;
    switch (options.recurrence) {
      case 'WEEKLY':
        return `Every ${start.weekday}, ${hours}${zone}, from ${from}`;
      case 'BIWEEKLY':
        return `Every other ${start.weekday}, ${hours}${zone}, from ${from}`;
      case 'MONTHLY':
        return `Monthly on the ${ordinal(start.day)}, ${hours}${zone}, from ${from}`;
      default: {
        const pattern = describeRepeatPattern(options.recurrence, startAt);
        if (pattern) return `${pattern}, ${hours}${zone}, from ${from}`;
      }
    }
  }

  if (span) return `${dayLabel(start, now)}, ${span}${zone}`;

  // Spans days: both ends in full. `end` is non-null here.
  return (
    `${dayLabel(start, now)}, ${clock(start)} ${start.period} – ` +
    `${dayLabel(end!, now)}, ${clock(end!)} ${end!.period}${zone}`
  );
}

/**
 * A due date as a member reads it: "Fri, Nov 14". `tasks.due_date` is a
 * calendar `date` with no zone, so it is rendered as written, never shifted.
 */
export function formatDueDate(date: string, now: Date = new Date()): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return date;
  // Noon UTC keeps the calendar day whatever zone formats it.
  const at = new Date(Date.UTC(year, month - 1, day, 12));
  return dayLabel(zonedParts(at, 'UTC'), zonedParts(now, 'UTC'));
}

/**
 * A task's due as a member reads it: "Fri, Nov 14" for a task due on a day,
 * "Fri, Nov 14, 5 PM" for one due at a time (#4003), with the zone's short
 * name when the zone is a fallback rather than the reader's own. Without a
 * zone at all the time is left off, so a guessed clock is never shown.
 */
export function formatTaskDue(
  dueDate: string,
  dueAt: string | null | undefined,
  options: { timeZone: string | null; labelZone?: boolean; now?: Date },
): string {
  const at = dueAt ? new Date(dueAt) : null;
  if (!at || Number.isNaN(at.getTime()) || !options.timeZone) {
    return formatDueDate(dueDate, options.now);
  }
  const parts = zonedParts(at, options.timeZone);
  const now = zonedParts(options.now ?? new Date(), options.timeZone);
  const zone = options.labelZone ? ` ${zoneLabel(at, options.timeZone)}` : '';
  return `${dayLabel(parts, now)}, ${clock(parts)} ${parts.period}${zone}`;
}

/** Joins the non-empty facts of a push body with {@link PUSH_SEPARATOR}. */
export function joinFacts(
  ...facts: (string | null | undefined | false)[]
): string {
  return facts.filter((fact): fact is string => !!fact).join(PUSH_SEPARATOR);
}
