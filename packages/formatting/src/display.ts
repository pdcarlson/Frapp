/**
 * The house date shapes: how a screen prints a day, a time or a span of them.
 *
 * Every helper here reads like mobile already reads: a short month and day
 * ("Nov 6"), a weekday where the day matters ("Fri, Nov 6"), the time after a
 * middle dot ("Fri, Nov 6 · 5:00 PM"), and an en-dashed range that says the
 * day period once ("5:00 – 7:00 PM"). None prints seconds, and none prints a
 * numeric date ("11/6/2026"), which is what `formatLocaleDateTime` and
 * `formatLocaleDate` give. The year appears only when the date is outside the
 * current one.
 *
 * Each takes a timestamp or a bare `YYYY-MM-DD` (read at local noon, so a
 * `date` column keeps its calendar day in every zone), and returns `null` for
 * a missing or unparseable value so the caller can leave the fact out rather
 * than print a placeholder (`spec/ui/web-dashboard/README.md`: an absent
 * value is absent, not a glyph).
 *
 * The relative forms ("Today · 5:00 PM", "Due tomorrow") are mobile's
 * `formatEventRowTime` and `formatDueSubtitle`, worded the same way so a
 * member reads one product across both apps.
 */

import { parseInstantOrBareLocalNoon } from "./bare-date";
import { dayDelta } from "./calendar-days";
import { parseInstant } from "./instant";
import { formatTimeOfDay, formatTimeOfDayShort } from "./locale";

function toDate(value: unknown): Date | null {
  if (typeof value !== "string" || value === "") return null;
  return parseInstantOrBareLocalNoon(value) ?? parseInstant(value);
}

function sameYear(at: Date, now: Date): boolean {
  return at.getFullYear() === now.getFullYear();
}

function monthDay(at: Date, now: Date): string {
  return at.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear(at, now) ? {} : { year: "numeric" }),
  });
}

function weekdayMonthDay(at: Date, now: Date): string {
  return at.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear(at, now) ? {} : { year: "numeric" }),
  });
}

/** The clock read off the parsed instant, so a bare date and a timestamp agree. */
function time(at: Date): string {
  return formatTimeOfDay(at.toISOString());
}

function weekdayName(at: Date): string {
  return at.toLocaleDateString(undefined, { weekday: "long" });
}

/** `"Nov 6"`, or `"Nov 6, 2025"` outside the current year. */
export function formatDay(
  value: unknown,
  now: Date = new Date(),
): string | null {
  const at = toDate(value);
  return at ? monthDay(at, now) : null;
}

/** `"Fri, Nov 6"`, with the year outside the current one. */
export function formatWeekdayDay(
  value: unknown,
  now: Date = new Date(),
): string | null {
  const at = toDate(value);
  return at ? weekdayMonthDay(at, now) : null;
}

/** `"Fri, Nov 6 · 5:00 PM"`, with the year outside the current one. */
export function formatDayTime(
  value: unknown,
  now: Date = new Date(),
): string | null {
  const at = toDate(value);
  return at ? `${weekdayMonthDay(at, now)} · ${time(at)}` : null;
}

/**
 * `"Fri, Nov 6 · 5:00 – 7:00 PM"`. The day period is said once when both ends
 * share it, and an end on another day names that day:
 * `"Fri, Nov 6 · 10:00 PM – Sat, Nov 7 · 1:00 AM"`. Without a readable end it
 * is {@link formatDayTime}.
 */
export function formatDayTimeRange(
  start: unknown,
  end: unknown,
  now: Date = new Date(),
): string | null {
  const from = toDate(start);
  if (!from) return null;
  const to = toDate(end);
  if (!to) return formatDayTime(start, now);
  if (dayDelta(from, to) !== 0) {
    return `${formatDayTime(start, now)} – ${formatDayTime(end, now)}`;
  }
  return `${weekdayMonthDay(from, now)} · ${formatTimeOfDayShort(from.toISOString(), to.toISOString())} – ${time(to)}`;
}

/**
 * `"Aug 24 – Dec 12, 2026"`: a span of days, the year said once at the end
 * when both ends share it, and on each end when they don't.
 */
export function formatDayRange(start: unknown, end: unknown): string | null {
  const from = toDate(start);
  const to = toDate(end);
  if (!from || !to) return null;
  const short: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const full: Intl.DateTimeFormatOptions = { ...short, year: "numeric" };
  if (from.getFullYear() === to.getFullYear()) {
    return `${from.toLocaleDateString(undefined, short)} – ${to.toLocaleDateString(undefined, full)}`;
  }
  return `${from.toLocaleDateString(undefined, full)} – ${to.toLocaleDateString(undefined, full)}`;
}

/**
 * A list row's when: `"Today · 5:00 PM"`, `"Tomorrow · 5:00 PM"`, the weekday
 * within the coming week (`"Friday · 5:00 PM"`), otherwise
 * `"Nov 6 · 5:00 PM"`, and `"Yesterday · 5:00 PM"` for the day before. Mobile's
 * event row (`formatEventRowTime`) has its own copy that lacks the yesterday
 * case and the out-of-year year, so the two differ there until mobile reads
 * this one (#3420).
 */
export function formatRelativeDayTime(
  value: unknown,
  now: Date = new Date(),
): string | null {
  const at = toDate(value);
  if (!at) return null;
  const days = dayDelta(now, at);
  const clock = time(at);
  if (days === 0) return `Today · ${clock}`;
  if (days === 1) return `Tomorrow · ${clock}`;
  if (days === -1) return `Yesterday · ${clock}`;
  if (days > 1 && days < 7) return `${weekdayName(at)} · ${clock}`;
  return `${monthDay(at, now)} · ${clock}`;
}

/**
 * A due date as a countdown: `"Due today"`, `"Due tomorrow"`, `"Due Friday"`
 * within the week, `"Due Nov 6"` beyond it, and `"Overdue by 2 days"` once it
 * has passed. Mobile's task subtitle (`formatDueSubtitle`) is a separate copy
 * that leaves the year off a date outside the current one, until mobile reads
 * this one (#3420).
 */
export function formatDueLabel(
  value: unknown,
  now: Date = new Date(),
): string | null {
  const due = toDate(value);
  if (!due) return null;
  const days = dayDelta(now, due);
  if (days < 0) return `Overdue by ${-days} ${days === -1 ? "day" : "days"}`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days < 7) return `Due ${weekdayName(due)}`;
  return `Due ${monthDay(due, now)}`;
}

/**
 * `"Nov 6, 2026, 5:00 PM"`: always the year, never seconds. For a tooltip or
 * an accessible name, where the whole instant is wanted and space is not
 * scarce; a visible row takes one of the shorter forms above.
 */
export function formatTimestampFull(value: unknown): string | null {
  const at = toDate(value);
  if (!at) return null;
  return at
    .toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
    .replace(/\u202f/g, " ");
}
