import { parseBareDateLocalNoon, parseInstant } from "@repo/formatting";

/** 52 weeks: last year's Saturday lands on a Saturday (#3930). */
const SHIFT_DAYS = 364;

/**
 * A date written out in full, with its year ("April 13, 2026"): a line about
 * last year must say which year, and dates are never abbreviated.
 */
function fullDate(at: Date | null): string {
  return at
    ? at.toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "";
}

/** An instant (an event's start), as the reader's own calendar day. */
export function lastYearDay(instant: string | null | undefined): string {
  return fullDate(parseInstant(instant));
}

/** A stored `YYYY-MM-DD` (a task's due date), in every time zone that day. */
export function lastYearBareDay(day: string | null | undefined): string {
  return fullDate(day ? parseBareDateLocalNoon(day) : null);
}

/**
 * The same weekday and time of day this year, in the reader's zone: 52 weeks
 * on by the calendar, so a clock change in between doesn't move the hour.
 */
export function sameWeekdayThisYear(instant: unknown): Date | null {
  const at = parseInstant(instant);
  if (!at) return null;
  const moved = new Date(at);
  moved.setDate(moved.getDate() + SHIFT_DAYS);
  return moved;
}

/**
 * Last year's name, for this year's event: "Winter Formal 2025" held in 2025
 * becomes "Winter Formal 2026". Only the year the event was held in moves, so
 * a count or a room number that happens to be four digits stays.
 */
export function nameForThisYear(
  name: string,
  lastYearStart: unknown,
  thisYearStart: Date | null,
): string {
  const held = parseInstant(lastYearStart);
  if (!held || !thisYearStart) return name;
  const from = String(held.getFullYear());
  const to = String(thisYearStart.getFullYear());
  return from === to
    ? name
    : name.replace(new RegExp(`(?<!\\d)${from}(?!\\d)`, "g"), to);
}
