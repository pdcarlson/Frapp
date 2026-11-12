/**
 * The iCalendar text a calendar subscription link serves (#3322, RFC 5545).
 *
 * The one `.ics` writer in the repo: the two hand-rolled builders behind the
 * old "Add to calendar" download were deleted in #3751, and this replaces
 * them with a feed rather than a file. Pure functions, so the rules a strict
 * importer holds a feed to (CRLF line ends, lines folded at 75 octets, text
 * escaped, `DTSTAMP` on every `VEVENT`) are pinned by unit tests.
 */

/** When an item happens: a moment, or a whole day with no time. */
export type IcsWhen =
  | { kind: 'instant'; start: string; end: string }
  | { kind: 'day'; date: string };

export interface IcsItem {
  /** Stable across fetches, so a calendar updates the item in place. */
  uid: string;
  when: IcsWhen;
  summary: string;
  description: string | null;
  location: string | null;
  /** The item's page in Frapp. */
  url: string;
}

export interface IcsCalendar {
  /** What the calendar app names the subscription. */
  name: string;
  items: readonly IcsItem[];
  /** The fetch time, written as every item's `DTSTAMP`. */
  now: Date;
}

const CRLF = '\r\n';

/**
 * How often a calendar app is asked to check again. Apple Calendar and Outlook
 * read one of the two; Google Calendar ignores both and keeps its own
 * schedule (several hours), which the spec states.
 */
const REFRESH_INTERVAL = 'PT1H';

/**
 * TEXT escaping (RFC 5545 § 3.3.11). Line breaks are normalised first, so a
 * description pasted with Windows line ends (`\r\n`) or a bare `\r` never
 * leaves a raw carriage return inside a property, which a reader takes for
 * the end of the line (the defect #1591 recorded in the old API builder).
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/** `2026-11-12T19:00:00.000Z` → `20261112T190000Z`. */
export function icsInstant(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Not a date-time: ${iso}`);
  }
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** `2026-11-12` → `20261112`. */
export function icsDate(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new RangeError(`Not a calendar day: ${day}`);
  }
  return day.replace(/-/g, '');
}

/** The day after `day` (`YYYY-MM-DD`), as `YYYYMMDD`: an all-day `DTEND`. */
function icsNextDate(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + 1));
  return next.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Fold a content line at 75 octets (RFC 5545 § 3.1): continuation lines start
 * with one space. Counted in UTF-8 bytes, and never inside a character, so a
 * name in any script survives the fold.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  // The first line holds 75 octets; each continuation, 74 after its space.
  let limit = 75;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (currentBytes + bytes > limit) {
      parts.push(current);
      current = '';
      currentBytes = 0;
      limit = 74;
    }
    current += char;
    currentBytes += bytes;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

function itemLines(item: IcsItem, stamp: string): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${item.uid}`, `DTSTAMP:${stamp}`];
  if (item.when.kind === 'day') {
    lines.push(
      `DTSTART;VALUE=DATE:${icsDate(item.when.date)}`,
      `DTEND;VALUE=DATE:${icsNextDate(item.when.date)}`,
      // A due day is not time the member is busy.
      'TRANSP:TRANSPARENT',
    );
  } else {
    const start = icsInstant(item.when.start);
    const end = icsInstant(item.when.end);
    lines.push(`DTSTART:${start}`);
    // DTEND must be later than DTSTART (RFC 5545 § 3.8.2.2). A moment with no
    // length, such as a task due at a time, leaves it out, which § 3.6.1
    // reads as an event that takes up no time.
    if (end > start) lines.push(`DTEND:${end}`);
  }
  lines.push(`SUMMARY:${escapeIcsText(item.summary)}`);
  if (item.location) lines.push(`LOCATION:${escapeIcsText(item.location)}`);
  if (item.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(item.description)}`);
  }
  // URI, not TEXT: not escaped (RFC 5545 § 3.8.4.6).
  lines.push(`URL:${item.url}`, 'END:VEVENT');
  return lines;
}

/** The whole calendar, CRLF-terminated. */
export function buildIcsCalendar(calendar: IcsCalendar): string {
  const stamp = icsInstant(calendar.now.toISOString());
  const name = escapeIcsText(calendar.name);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Frapp//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `NAME:${name}`,
    `X-WR-CALNAME:${name}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH_INTERVAL}`,
    `X-PUBLISHED-TTL:${REFRESH_INTERVAL}`,
    ...calendar.items.flatMap((item) => itemLines(item, stamp)),
    'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}
