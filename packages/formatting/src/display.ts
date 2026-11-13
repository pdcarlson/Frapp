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
 * The relative forms ("Today · 5:00 PM", "Due tomorrow") read the same on
 * both apps, so a member reads one product. Mobile's Events headings and
 * up-next strip read `formatDayHeading` here, and since #4135 its task due
 * lines (`formatDueSubtitle`, `formatDueDate`) and event window read
 * `formatDueLabel`, `formatDueOn` and `formatEventWindow`.
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
  return withTimes(weekdayMonthDay(from, now), from, toDate(end), now);
}

/**
 * `"<day> · 5:00 – 7:00 PM"`: a day label followed by a time range. The day
 * period is said once when both ends share it; an end on another day names
 * that day (`"<day> · 10:00 PM – Sat, Nov 7 · 1:00 AM"`); without a readable
 * end it is just the start time. Shared by {@link formatDayTimeRange} and
 * {@link formatEventWindow}, so the two can't word a range differently.
 */
function withTimes(
  day: string,
  from: Date,
  to: Date | null,
  now: Date,
): string {
  if (!to) return `${day} · ${time(from)}`;
  if (dayDelta(from, to) !== 0) {
    return `${day} · ${time(from)} – ${weekdayMonthDay(to, now)} · ${time(to)}`;
  }
  return `${day} · ${formatTimeOfDayShort(from.toISOString(), to.toISOString())} – ${time(to)}`;
}

/**
 * An event's when, worded for someone deciding whether to go:
 * `"Tonight · 6:00 – 7:00 PM"` (today from 5 PM on), `"Today · 9:00 –
 * 10:00 AM"`, `"Tomorrow · …"`, the weekday within the coming week
 * (`"Friday · …"`), otherwise `"Sat, Mar 14 · …"` with the year outside the
 * current one. An end on another day names that day, as
 * {@link formatDayTimeRange} does. Both apps' chat event cards and the phone's
 * event detail read this one (#4135), so a member reads the same line on each.
 */
export function formatEventWindow(
  start: unknown,
  end: unknown,
  now: Date = new Date(),
): string | null {
  const from = toDate(start);
  if (!from) return null;
  const days = dayDelta(now, from);
  let day: string;
  if (days === 0) {
    // "Tonight" only when it reads true; a 9am meeting today is not tonight.
    day = from.getHours() >= 17 ? "Tonight" : "Today";
  } else if (days === 1) {
    day = "Tomorrow";
  } else if (days > 1 && days < 7) {
    day = weekdayName(from);
  } else {
    day = weekdayMonthDay(from, now);
  }
  return withTimes(day, from, toDate(end), now);
}

/**
 * A point count in a sentence or a metadata line: `"1 point"`, `"10
 * points"`. Both apps write a count this way wherever it is read as text
 * (#4135); a chip, where space is tight, takes {@link formatPointsChip}.
 */
export function formatPoints(value: number): string {
  return `${value} ${value === 1 ? "point" : "points"}`;
}

/**
 * A reward on a chip or badge: `"+10 pts"`. The one short form both apps
 * draw on a points chip (#4135).
 */
export function formatPointsChip(value: number): string {
  return `+${value} pts`;
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
 * `"Nov 6 · 5:00 PM"`, and `"Yesterday · 5:00 PM"` for the day before.
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
 * A list's day heading, written out: `"Today"`, `"Tomorrow"`, `"Yesterday"`,
 * the weekday within the coming week (`"Sunday"`), otherwise the month and
 * day (`"November 14"`, `"January 3, 2027"` outside the current year). The
 * Events lists group their rows under these (#3707); a row under one then
 * says only its time.
 */
export function formatDayHeading(
  value: unknown,
  now: Date = new Date(),
): string | null {
  const at = toDate(value);
  if (!at) return null;
  const days = dayDelta(now, at);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1 && days < 7) return weekdayName(at);
  return at.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    ...(sameYear(at, now) ? {} : { year: "numeric" }),
  });
}

/**
 * When something was sent, in words: `"Sent today at 4:46 PM"`,
 * `"Sent yesterday at 9:00 AM"`, `"Sent Nov 3 at …"` (a past day reads as its
 * date; only a time ahead of the device clock could read as a weekday).
 * Read by web's and mobile's invite lists.
 */
export function formatSentLabel(
  value: unknown,
  now: Date = new Date(),
): string | null {
  return formatActedLabel("Sent", value, now);
}

/**
 * When something was done, led by what was done: `"Submitted today at
 * 9:04 PM"`, `"Resubmitted yesterday at 8:00 AM"`, `"Submitted Nov 3 at …"`.
 * `formatSentLabel` is this with `"Sent"`; a task review says when the work
 * was handed in with it (#4693).
 */
export function formatActedLabel(
  verb: string,
  value: unknown,
  now: Date = new Date(),
): string | null {
  const when = formatRelativeDayTime(value, now);
  if (!when) return null;
  const [day = when, clock] = when.split(" · ");
  const spoken = /^(Today|Yesterday|Tomorrow)$/.test(day)
    ? day.toLowerCase()
    : day;
  return clock ? `${verb} ${spoken} at ${clock}` : `${verb} ${spoken}`;
}

/**
 * A due date as a countdown: `"Due today"`, `"Due tomorrow"`, `"Due Friday"`
 * within the week, `"Due Nov 6"` beyond it, and `"Overdue by 2 days"` once it
 * has passed. Both apps' task due lines read this one (#4135), through
 * `@repo/hooks`' `taskDueLine` and mobile's `formatDueSubtitle`.
 *
 * A task due at a time of day passes its `due_at` instant instead of its
 * `due_date` (#4003), and the countdown names the time: `"Due today at
 * 5 PM"`, `"Due Friday at 11:59 PM"`, `"Due Nov 14 at 9 AM"`. Once that
 * minute has passed it is overdue by the minute or hour within the first
 * day (`"Overdue by 40 minutes"`, `"Overdue by 3 hours"`), then by the day.
 */
export function formatDueLabel(
  value: unknown,
  now: Date = new Date(),
): string | null {
  const due = toDate(value);
  if (!due) return null;
  if (isInstant(value)) return timedDueLabel(due, now);
  const days = dayDelta(now, due);
  if (days < 0) return `Overdue by ${-days} ${days === -1 ? "day" : "days"}`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days < 7) return `Due ${weekdayName(due)}`;
  return `Due ${monthDay(due, now)}`;
}

/**
 * Whether a due date has passed: a bare day once that day is over, a task
 * due at a time (#4003) from that minute. The one rule both apps draw a due
 * date in red by (Shawn's pick, #4133, 2026-11-12): due today or tomorrow
 * stays plain. `false` for a missing or unreadable date.
 */
export function isDueOverdue(value: unknown, now: Date = new Date()): boolean {
  return formatDueLabel(value, now)?.startsWith("Overdue") ?? false;
}

/** A full timestamp rather than a bare `YYYY-MM-DD` day. */
function isInstant(value: unknown): boolean {
  return typeof value === "string" && value.length > 10;
}

function timedDueLabel(due: Date, now: Date): string {
  const minutesLeft = (due.getTime() - now.getTime()) / 60_000;
  if (minutesLeft <= 0) {
    const late = -minutesLeft;
    if (late < 60) {
      const minutes = Math.max(1, Math.floor(late));
      return `Overdue by ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
    }
    if (late < 24 * 60) {
      const hours = Math.floor(late / 60);
      return `Overdue by ${hours} ${hours === 1 ? "hour" : "hours"}`;
    }
    const days = Math.max(1, -dayDelta(now, due));
    return `Overdue by ${days} ${days === 1 ? "day" : "days"}`;
  }
  return `Due ${dueDayWords(due, now)} at ${formatClockShort(due)}`;
}

/** "today", "tomorrow", "Friday" within the week, else "Nov 14". */
function dueDayWords(due: Date, now: Date): string {
  const days = dayDelta(now, due);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1 && days < 7) return weekdayName(due);
  return monthDay(due, now);
}

/**
 * `"5 PM"`, `"5:30 PM"`: a time of day as a calendar writes it, the minutes
 * only when there are some. For a due time, where `"5:00 PM"` is noise.
 */
export function formatClockShort(value: Date | string): string {
  const at = typeof value === "string" ? toDate(value) : value;
  if (!at || Number.isNaN(at.getTime())) return "";
  return at
    .toLocaleTimeString(undefined, {
      hour: "numeric",
      ...(at.getMinutes() === 0 ? {} : { minute: "2-digit" }),
    })
    .replace(/\u202f/g, " ");
}

/**
 * A task's due without a countdown, for one whose countdown would not be
 * true (handed in, or read by someone who can't see its status): `"Due Nov
 * 14"`, or `"Due Nov 14 at 5 PM"` for a task due at a time (#4003). Takes the
 * task's `due_at` when it has one, else its `due_date`.
 */
export function formatDueOn(
  value: unknown,
  now: Date = new Date(),
): string | null {
  const due = toDate(value);
  if (!due) return null;
  const day = monthDay(due, now);
  return isInstant(value)
    ? `Due ${day} at ${formatClockShort(due)}`
    : `Due ${day}`;
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
