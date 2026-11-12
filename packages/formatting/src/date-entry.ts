import { parseBareDateLocalNoon } from "./bare-date";
import { dayDelta } from "./calendar-days";
import { localIsoDate } from "./local-date";

/**
 * Which way a date typed with no year leans (#3937).
 *
 * - `ahead`: the next time it comes round, today included. A task's due date
 *   or an event: almost always in the next days or weeks (#3928).
 * - `back`: the last time it came round, today included. A day already
 *   worked, a document's date, where an import starts, and a range filter
 *   over what already happened (reports, documents, chat search).
 * - `nearest`: whichever of the two is closer. A semester's start and end
 *   sit on either side of today.
 */
export type DateLean = "ahead" | "back" | "nearest";

/**
 * A date as a member types it (#3928, #3937). A month and a day are enough
 * and the year is worked out from `lean` ({@link DateLean}). A year is only
 * read when one is typed, which is how a date further off is still reachable.
 *
 * Reads, case-insensitively:
 *
 * - `today`, `tomorrow`, `yesterday`, `next week` and `last week` (seven
 *   days on or back);
 * - a weekday, `fri` or `Friday`: the next one after today when leaning
 *   ahead, the last one before today when leaning back, and the one within
 *   three days either way (today included) for `nearest`;
 * - a month and a day in either order, `Nov 14`, `November 14th`, `14 Nov`,
 *   with an optional year, `Nov 14 2027`;
 * - numbers, month first, `11/14` or `11-14`, with an optional year,
 *   `11/14/27` or `11/14 2027`;
 * - `2027-11-14`, what the API takes and what a prefill carries;
 * - its own output ({@link formatDateEntry}), so a shown value reads back to
 *   the date it shows.
 *
 * Month-first is the one locale assumption: the product is for US chapters.
 * A date that names its year is taken as written, past or not, as the date
 * input this replaced took it, within {@link MIN_YEAR} to {@link MAX_YEAR}.
 *
 * `/task` runs this over what follows the `@member`, where a number may be the
 * point reward instead, so it reads narrowly: no `1.5` (a dotted date), no
 * `tom` (a name), and a year after a space only as four digits in range, so
 * `11/14 10` and `Nov 14 1000` are never a date in year 2010 or 1000. Returns `YYYY-MM-DD`, or `null` for text that
 * is not a date (`Feb 30`, `soon`).
 */
export function parseDateEntry(
  raw: string,
  now: Date,
  lean: DateLean = "ahead",
): string | null {
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

  if (text === "today") return inDays(0);
  if (text === "tomorrow" || text === "tmrw") return inDays(1);
  if (text === "yesterday") return inDays(-1);
  if (text === "next week") return inDays(7);
  if (text === "last week") return inDays(-7);

  const weekday = indexOfName(WEEKDAYS, text);
  if (weekday !== null) {
    const ahead = (weekday - today.getDay() + 7) % 7;
    if (lean === "ahead") return inDays(ahead || 7);
    if (lean === "back") return inDays(-((7 - ahead) % 7 || 7));
    return inDays(ahead <= 3 ? ahead : ahead - 7);
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) {
    return dated(Number(iso[2]), Number(iso[3]), Number(iso[1]), today, lean);
  }

  const numeric =
    /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4})| (\d{4}))?$/.exec(text);
  if (numeric) {
    return dated(
      Number(numeric[1]),
      Number(numeric[2]),
      yearOf(numeric[3] ?? numeric[4]),
      today,
      lean,
    );
  }

  // "Fri, Nov 14" reads as "Nov 14": the weekday is decoration on a date.
  const words = text.split(" ");
  const rest =
    words.length > 2 && indexOfName(WEEKDAYS, words[0]!) !== null
      ? words.slice(1).join(" ")
      : text;

  const monthFirst = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(
    rest,
  );
  if (monthFirst) {
    const month = indexOfName(MONTHS, monthFirst[1]!);
    if (month === null) return null;
    return dated(
      month + 1,
      Number(monthFirst[2]),
      yearOf(monthFirst[3]),
      today,
      lean,
    );
  }

  const dayFirst = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)(?: (\d{4}))?$/.exec(
    rest,
  );
  if (dayFirst) {
    const month = indexOfName(MONTHS, dayFirst[2]!);
    if (month === null) return null;
    return dated(
      month + 1,
      Number(dayFirst[1]),
      yearOf(dayFirst[3]),
      today,
      lean,
    );
  }

  return null;
}

/**
 * How a date field shows a held date, written out the way the owner reads
 * dates everywhere else (2026-11-07: no abbreviations): `Today`, `Tomorrow`,
 * `Yesterday`, the weekday within six days (`Friday`), otherwise the month
 * and day (`November 14`), with the year outside the current one or where
 * the same text typed back would land in another year (`March 14, 2027`).
 *
 * Every form it writes reads back through {@link parseDateEntry} with the same
 * `lean` to the date it shows, so leaving the field never moves the date. That
 * is the test each form passes before it is used: a weekday that would read
 * back as another week, or a month and day that would read back as another
 * year, falls through to the next, longer form.
 *
 * English, in every locale, like the names the parser reads. Formatting in
 * the browser's locale would write `"sábado"` into a field that could not
 * read it back.
 */
export function formatDateEntry(
  entry: string,
  now: Date,
  lean: DateLean = "ahead",
): string {
  const [isoDate = entry, time] = entry.split("T");
  const day = formatDateDay(isoDate, now, lean);
  if (!time || !TIME_OF_DAY.test(time)) return day;
  return `${day} · ${formatDueTimeLabel(time)}`;
}

function formatDateDay(isoDate: string, now: Date, lean: DateLean): string {
  const at = parseBareDateLocalNoon(isoDate);
  if (!at) return isoDate;
  const offset = dayDelta(now, at);
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  if (offset === -1) return "Yesterday";
  const readsBack = (text: string) =>
    parseDateEntry(text, now, lean) === isoDate;
  if (Math.abs(offset) <= 6) {
    const weekday = capitalized(WEEKDAYS[at.getDay()]!);
    if (readsBack(weekday)) return weekday;
  }
  const monthDay = `${capitalized(MONTHS[at.getMonth()]!)} ${at.getDate()}`;
  if (at.getFullYear() === now.getFullYear() && readsBack(monthDay)) {
    return monthDay;
  }
  return `${monthDay}, ${at.getFullYear()}`;
}

/**
 * A time of day as a due field shows it on web and the phone: `"5 PM"`,
 * `"9:30 AM"`, `"12 PM"`. The minutes only when there are some, as a
 * calendar writes a time; English, like the rest of the field. `time` is
 * `HH:MM` on the 24-hour clock.
 */
export function formatDueTimeLabel(time: string): string {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const period = hours < 12 ? "AM" : "PM";
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === 0
    ? `${hour} ${period}`
    : `${hour}:${String(minutes).padStart(2, "0")} ${period}`;
}

/** `HH:MM`: how a due entry carries its time of day. */
export const TIME_OF_DAY = /^\d{2}:\d{2}$/;

/**
 * {@link parseDateEntry} with an optional time of day (#4003), the way
 * Todoist reads "Fri 5pm": a time before or after the date, `5pm`,
 * `5:30 pm`, `at 9am`, `17:30` or `noon`, and a time alone for today (or,
 * leaning ahead, tomorrow once that time has passed today). Returns `YYYY-MM-DD` for a date
 * with no time, `YYYY-MM-DDTHH:MM` (device-local wall time) for one with a
 * time, or `null` for text that is neither.
 *
 * A time needs `am`/`pm`, a colon or a word, so a bare number is never one:
 * `/task` reads a trailing number as the point reward.
 */
export function parseDateEntryWithTime(
  raw: string,
  now: Date,
  lean: DateLean = "ahead",
): string | null {
  const text = raw
    .trim()
    .toLowerCase()
    .replace(/·/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  const found = findTime(text);
  if (!found) return parseDateEntry(text, now, lean);

  const rest = found.rest.replace(/(^|\s)at$/, "").trim();
  const time = `${pad(found.hours)}:${pad(found.minutes)}`;
  if (!rest) {
    const today = localIsoDate(now);
    const passed =
      found.hours * 60 + found.minutes <=
      now.getHours() * 60 + now.getMinutes();
    if (!passed || lean !== "ahead") return `${today}T${time}`;
    const tomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );
    return `${localIsoDate(tomorrow)}T${time}`;
  }
  const date = parseDateEntry(rest, now, lean);
  return date ? `${date}T${time}` : null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * A time of day at the start or the end of the text, and what is left
 * around it. `null` when there is none.
 */
function findTime(
  text: string,
): { hours: number; minutes: number; rest: string } | null {
  const patterns = [
    // 5pm, 5 pm, 5:30pm, 5:30 p.m., 5p
    /(?:^|\s)(?:at )?(\d{1,2})(?::(\d{2}))? ?(a|p)\.?m?\.?$/,
    /^(?:at )?(\d{1,2})(?::(\d{2}))? ?(a|p)\.?m?\.?(?=\s|$)/,
    // 17:30, 9:00
    /(?:^|\s)(?:at )?(\d{1,2}):(\d{2})()$/,
    /^(?:at )?(\d{1,2}):(\d{2})()(?=\s|$)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    let hours = Number(match[1]);
    const minutes = match[2] ? Number(match[2]) : 0;
    const period = match[3];
    if (minutes > 59) return null;
    if (period) {
      if (hours < 1 || hours > 12) return null;
      if (period === "p" && hours !== 12) hours += 12;
      if (period === "a" && hours === 12) hours = 0;
    } else if (hours > 23) {
      return null;
    }
    const rest = (
      text.slice(0, match.index) + text.slice(match.index + match[0].length)
    ).trim();
    return { hours, minutes, rest };
  }
  const noon = /(?:^|\s)(?:at )?noon$|^(?:at )?noon(?=\s|$)/.exec(text);
  if (noon) {
    const rest = (
      text.slice(0, noon.index) + text.slice(noon.index + noon[0].length)
    ).trim();
    return { hours: 12, minutes: 0, rest };
  }
  return null;
}

/**
 * What the API takes for a due entry: the day, and the instant when the
 * entry has a time, read in the device's zone (`POST /v1/tasks` `due_at`).
 */
export function dueEntryFields(entry: string): {
  due_date: string;
  due_at?: string;
} {
  const [date = entry, time] = entry.split("T");
  if (!time || !TIME_OF_DAY.test(time)) return { due_date: date };
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  const at = new Date(year, month - 1, day, hours, minutes);
  return { due_date: date, due_at: at.toISOString() };
}

/**
 * The entry a task's due reads back as: its `due_date`, with the device-local
 * time of its `due_at` when it has one. The inverse of {@link dueEntryFields}.
 */
export function dueEntryFromTask(task: {
  due_date: string;
  due_at?: string | null;
}): string {
  const at = task.due_at ? new Date(task.due_at) : null;
  if (!at || Number.isNaN(at.getTime())) return task.due_date;
  return `${localIsoDate(at)}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
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

/** The years a typed year may name. Outside them the text is not a date. */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** A leap day's next or last occurrence is at most eight years away (2096 → 2104). */
const YEARS_TO_SEARCH = 8;

function dated(
  month: number,
  day: number,
  year: number | undefined,
  today: Date,
  lean: DateLean,
): string | null {
  if (year !== undefined) {
    if (year < MIN_YEAR || year > MAX_YEAR) return null;
    const at = calendarDay(year, month, day);
    return at ? localIsoDate(at) : null;
  }
  const ahead = occurrence(month, day, today, 1);
  const back = occurrence(month, day, today, -1);
  if (lean === "ahead") return ahead ? localIsoDate(ahead) : null;
  if (lean === "back") return back ? localIsoDate(back) : null;
  if (!ahead || !back) return null;
  const closer =
    ahead.getTime() - today.getTime() <= today.getTime() - back.getTime()
      ? ahead
      : back;
  return localIsoDate(closer);
}

/**
 * The first time a month and day come round from today in one direction,
 * today included.
 */
function occurrence(
  month: number,
  day: number,
  today: Date,
  step: 1 | -1,
): Date | null {
  for (let offset = 0; offset <= YEARS_TO_SEARCH; offset += 1) {
    const at = calendarDay(today.getFullYear() + offset * step, month, day);
    if (!at) continue;
    if (
      step === 1
        ? at.getTime() >= today.getTime()
        : at.getTime() <= today.getTime()
    ) {
      return at;
    }
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
