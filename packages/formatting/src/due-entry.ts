import { parseBareDateLocalNoon } from "./bare-date";
import { localIsoDate } from "./local-date";

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
 * - numbers, month first, `11/14` or `11-14`, with an optional year,
 *   `11/14/27` or `11/14 2027`;
 * - `2027-11-14`, what the API takes and what a prefill carries;
 * - its own output ({@link formatDueEntry}), so a shown value reads back to
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

  if (text === "today") return inDays(0);
  if (text === "tomorrow" || text === "tmrw") return inDays(1);
  if (text === "next week") return inDays(7);

  const weekday = indexOfName(WEEKDAYS, text);
  if (weekday !== null) {
    return inDays((weekday - today.getDay() + 7) % 7 || 7);
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return dated(Number(iso[2]), Number(iso[3]), Number(iso[1]), today);

  const numeric =
    /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4})| (\d{4}))?$/.exec(text);
  if (numeric) {
    return dated(
      Number(numeric[1]),
      Number(numeric[2]),
      yearOf(numeric[3] ?? numeric[4]),
      today,
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
    );
  }

  const dayFirst = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)(?: (\d{4}))?$/.exec(
    rest,
  );
  if (dayFirst) {
    const month = indexOfName(MONTHS, dayFirst[2]!);
    if (month === null) return null;
    return dated(month + 1, Number(dayFirst[1]), yearOf(dayFirst[3]), today);
  }

  return null;
}

/**
 * How a due field shows a held date: `"Sat, Nov 14"` for a day still to come
 * this year, and `"Mar 14, 2027"` for any other, so a far-off date is never
 * ambiguous. The year takes the weekday's place: web's Add a task row gives
 * the field half a column, and `"Sun, Mar 14, 2027"` ran past its edge.
 *
 * A day already past shows its year even inside the current one, because
 * {@link parseDueEntry} reads a date with no year as the next time it comes
 * round: `"Mon, Nov 2"` shown for last week would read back as next year's.
 *
 * English, in every locale, like the names the parser reads. Formatting in
 * the browser's locale would write `"sáb, 14 de nov"` into a field that could
 * not read it back.
 */
export function formatDueEntry(entry: string, now: Date): string {
  const [isoDate = entry, time] = entry.split("T");
  const day = formatDueDay(isoDate, now);
  if (!time || !TIME_OF_DAY.test(time)) return day;
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  return `${day} · ${clockWords(hours, minutes)}`;
}

function formatDueDay(isoDate: string, now: Date): string {
  const at = parseBareDateLocalNoon(isoDate);
  if (!at) return isoDate;
  const month = capitalized(MONTHS[at.getMonth()]!.slice(0, 3));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const upcomingThisYear =
    at.getFullYear() === now.getFullYear() && at.getTime() >= today.getTime();
  if (!upcomingThisYear) {
    return `${month} ${at.getDate()}, ${at.getFullYear()}`;
  }
  const weekday = capitalized(WEEKDAYS[at.getDay()]!.slice(0, 3));
  return `${weekday}, ${month} ${at.getDate()}`;
}

/** `"5 PM"`, `"5:30 PM"`, `"12 PM"`: English, like the rest of the field. */
function clockWords(hours: number, minutes: number): string {
  const period = hours < 12 ? "AM" : "PM";
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === 0
    ? `${hour} ${period}`
    : `${hour}:${String(minutes).padStart(2, "0")} ${period}`;
}

const TIME_OF_DAY = /^\d{2}:\d{2}$/;

/**
 * {@link parseDueEntry} with an optional time of day (#4003), the way
 * Todoist reads "Fri 5pm": a time before or after the date, `5pm`,
 * `5:30 pm`, `at 9am`, `17:30` or `noon`, and a time alone for today (or
 * tomorrow once that time has passed today). Returns `YYYY-MM-DD` for a date
 * with no time, `YYYY-MM-DDTHH:MM` (device-local wall time) for one with a
 * time, or `null` for text that is neither.
 *
 * A time needs `am`/`pm`, a colon or a word, so a bare number is never one:
 * `/task` reads a trailing number as the point reward.
 */
export function parseDueEntryWithTime(raw: string, now: Date): string | null {
  const text = raw
    .trim()
    .toLowerCase()
    .replace(/·/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  const found = findTime(text);
  if (!found) return parseDueEntry(text, now);

  const rest = found.rest.replace(/(^|\s)at$/, "").trim();
  const time = `${pad(found.hours)}:${pad(found.minutes)}`;
  if (!rest) {
    const today = localIsoDate(now);
    const passed =
      found.hours * 60 + found.minutes <=
      now.getHours() * 60 + now.getMinutes();
    if (!passed) return `${today}T${time}`;
    const tomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );
    return `${localIsoDate(tomorrow)}T${time}`;
  }
  const date = parseDueEntry(rest, now);
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

/** A leap day's next occurrence is at most eight years out (2096 → 2104). */
const YEARS_TO_SEARCH = 8;

function dated(
  month: number,
  day: number,
  year: number | undefined,
  today: Date,
): string | null {
  if (year !== undefined) {
    if (year < MIN_YEAR || year > MAX_YEAR) return null;
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
