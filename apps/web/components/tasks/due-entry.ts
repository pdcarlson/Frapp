import {
  formatDay,
  formatWeekdayDay,
  localIsoDate,
  parseBareDateLocalNoon,
} from "@repo/formatting";

/**
 * A task's due date as a member types it (#3928). Almost every task is due in
 * the next days or weeks, so a month and a day are enough and the year is
 * worked out: the next time that date comes round, today included. A year is
 * only read when one is typed, which is how a date a year or more out (an
 * annual chore set ahead) is still reachable.
 *
 * Reads, case-insensitively:
 *
 * - `today`, `tomorrow`, `next week` (seven days on);
 * - a weekday, `fri` or `Friday`: the next one after today;
 * - a month and a day in either order, `Nov 14`, `November 14th`, `14 Nov`,
 *   with an optional year, `Nov 14 2027`;
 * - numbers, month first, `11/14`, `11-14`, `11.14`, with an optional two- or
 *   four-digit year, `11/14/27`;
 * - `2027-11-14`, what the API takes and what a prefill carries;
 * - its own output ({@link formatDueEntry}), so a shown value reads back.
 *
 * Month-first is the one locale assumption: the product is for US chapters.
 * A date that names its year is taken as written, past or not, as the date
 * input this replaced took it. Returns `YYYY-MM-DD`, or `null` for text that
 * is not a date (`Feb 30`, `soon`).
 */
export function parseDueEntry(raw: string, now: Date): string | null {
  const text = raw
    .trim()
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/([a-z])\./g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const inDays = (days: number) => {
    const next = new Date(today);
    next.setDate(next.getDate() + days);
    return localIsoDate(next);
  };

  if (text === "today" || text === "tod") return inDays(0);
  if (text === "tomorrow" || text === "tom" || text === "tmrw") {
    return inDays(1);
  }
  if (text === "next week") return inDays(7);

  const weekday = indexOfName(WEEKDAYS, text);
  if (weekday !== null) {
    return inDays((weekday - today.getDay() + 7) % 7 || 7);
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return dated(Number(iso[2]), Number(iso[3]), Number(iso[1]), today);

  const numeric = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(text);
  if (numeric) {
    return dated(
      Number(numeric[1]),
      Number(numeric[2]),
      yearOf(numeric[3]),
      today,
    );
  }

  // "Fri, Nov 14" reads as "Nov 14": the weekday is decoration on a date.
  const words = text.split(" ");
  const rest =
    words.length > 2 && indexOfName(WEEKDAYS, words[0]!) !== null
      ? words.slice(1).join(" ")
      : text;

  const monthFirst =
    /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(rest);
  if (monthFirst) {
    const month = indexOfName(MONTHS, monthFirst[1]!);
    if (month === null) return null;
    return dated(month + 1, Number(monthFirst[2]), yearOf(monthFirst[3]), today);
  }

  const dayFirst =
    /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)(?: (\d{4}))?$/.exec(rest);
  if (dayFirst) {
    const month = indexOfName(MONTHS, dayFirst[2]!);
    if (month === null) return null;
    return dated(month + 1, Number(dayFirst[1]), yearOf(dayFirst[3]), today);
  }

  return null;
}

/**
 * How the field shows a held date: `"Sat, Nov 14"`, and `"Mar 14, 2027"`
 * outside the current year, so a far-off date is never ambiguous. The year
 * takes the weekday's place there: the Add a task row's due field is half a
 * column wide, and `"Sun, Mar 14, 2027"` ran past its edge.
 */
export function formatDueEntry(isoDate: string, now: Date): string {
  const at = parseBareDateLocalNoon(isoDate);
  if (!at) return isoDate;
  const shown =
    at.getFullYear() === now.getFullYear()
      ? formatWeekdayDay(isoDate, now)
      : formatDay(isoDate, now);
  return shown ?? isoDate;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** A full name or a prefix of three letters or more: `nov`, `sept`, `thurs`. */
function indexOfName(names: string[], word: string): number | null {
  if (word.length < 3) return null;
  const index = names.findIndex((name) => name.startsWith(word));
  return index === -1 ? null : index;
}

function yearOf(token: string | undefined): number | undefined {
  if (token === undefined) return undefined;
  return token.length === 2 ? 2000 + Number(token) : Number(token);
}

/** A leap day's next occurrence is at most eight years out (2096 → 2104). */
const YEARS_TO_SEARCH = 8;

function dated(
  month: number,
  day: number,
  year: number | undefined,
  today: Date,
): string | null {
  if (year !== undefined) {
    const at = calendarDay(year, month, day);
    return at ? localIsoDate(at) : null;
  }
  for (let offset = 0; offset <= YEARS_TO_SEARCH; offset += 1) {
    const at = calendarDay(today.getFullYear() + offset, month, day);
    if (at && at.getTime() >= today.getTime()) return localIsoDate(at);
  }
  return null;
}

/** `null` for a day the calendar doesn't have, which `Date` would roll over. */
function calendarDay(year: number, month: number, day: number): Date | null {
  const at = new Date(year, month - 1, day);
  return at.getFullYear() === year &&
    at.getMonth() === month - 1 &&
    at.getDate() === day
    ? at
    : null;
}
