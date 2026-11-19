import { guessMeetingType } from "./meeting-copy";

/**
 * Meetings, tied to their events (`spec/behavior/meetings.md` § Where
 * minutes are kept; Paul, 2026-11-19: "Build all of it"): the meetings on
 * the calendar that ended without minutes, and the next one coming, worked
 * out the same way on web and the phone from the events and minutes a
 * member already reads.
 */

/** An event as the calendar read gives it. */
export interface CalendarMeeting {
  id: string;
  name: string;
  start_time: string;
  end_time?: string | null;
}

/** How far back "Needs minutes" reaches: a month, past which it is history. */
export const NEEDS_MINUTES_DAYS = 30;
/** How far ahead "Next up" looks. */
export const NEXT_UP_DAYS = 7;
/** An event with no end is taken as an hour long. */
const ASSUMED_LENGTH_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Whether an event's name reads as a meeting: one whose type it suggests
 * (Chapter, Exec, Committee), or one that says "meeting". A social or a
 * philanthropy event is not, so it never asks for minutes.
 */
export function isMeetingLikeName(name: string): boolean {
  return (
    guessMeetingType(name) !== "other" || /\bmeetings?\b/i.test(name.trim())
  );
}

function endOf(event: CalendarMeeting): number {
  const start = Date.parse(event.start_time);
  const end = event.end_time ? Date.parse(event.end_time) : Number.NaN;
  return Number.isFinite(end) ? end : start + ASSUMED_LENGTH_MS;
}

/**
 * The meetings that ended in the last month with no minutes the reader can
 * see or take notes on, newest first, and the next meeting in the coming
 * week that has none yet. `started` holds the event ids that already have
 * minutes (posted or a draft) or notes the reader was added to.
 */
export function minutesToWrite(
  events: readonly CalendarMeeting[],
  started: ReadonlySet<string>,
  now: number,
): { needs: CalendarMeeting[]; next: CalendarMeeting | null } {
  const meetings = events.filter(
    (event) =>
      !!event?.id &&
      Number.isFinite(Date.parse(event.start_time)) &&
      isMeetingLikeName(event.name ?? "") &&
      !started.has(event.id),
  );
  const needs = meetings
    .filter((event) => {
      const start = Date.parse(event.start_time);
      return endOf(event) <= now && start >= now - NEEDS_MINUTES_DAYS * DAY_MS;
    })
    .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
  const next =
    meetings
      .filter((event) => {
        const start = Date.parse(event.start_time);
        return start > now && start <= now + NEXT_UP_DAYS * DAY_MS;
      })
      .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time))[0] ??
    null;
  return { needs, next };
}
