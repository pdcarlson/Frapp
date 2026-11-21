import { guessMeetingType } from "./meeting-copy";

/**
 * Meetings, tied to their events (`spec/behavior/meetings.md` § Meetings,
 * tied to their events; Paul, 2026-11-19: "Build all of it"): the meetings on
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

/** How far back the list asks for minutes (Write minutes rows) or shows a No minutes mark: a month, past which it is history. */
export const NEEDS_MINUTES_DAYS = 30;
/** How far ahead "Next up" looks. */
export const NEXT_UP_DAYS = 7;
/** An event with no end is taken as an hour long. */
const ASSUMED_LENGTH_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Words a meeting's own name is made of, beside the day it falls on. */
const MEETING_WORDS = new Set([
  "chapter",
  "chapters",
  "exec",
  "executive",
  "e-board",
  "eboard",
  "board",
  "officer",
  "officers",
  "cabinet",
  "council",
  "committee",
  "committees",
  "chair",
  "chairs",
  "general",
  "body",
  "gbm",
  "gm",
  "session",
  "weekly",
  "biweekly",
  "monthly",
  "of",
  "the",
  "and",
]);
/** Words that name a body that meets: "Recruitment Committee". */
const BODY_ENDINGS = /\b(committee|cabinet|council)$/;

/**
 * Whether an event's name reads as a meeting: one that says "meeting", one
 * made only of a meeting's own words ("Chapter", "Exec Board", "Committee
 * chairs"), or one that names a committee ("Recruitment Committee"). A
 * social, even one a type word starts ("Chapter Formal", "Exec Retreat"),
 * or a philanthropy event is not, so it never asks for minutes.
 */
export function isMeetingLikeName(name: string): boolean {
  const text = name.trim().toLowerCase();
  if (/\b(meetings?|mtg)\b/.test(text)) return true;
  if (guessMeetingType(text) === "other") return false;
  const words = text
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return false;
  return (
    words.every((word) => MEETING_WORDS.has(word)) ||
    BODY_ENDINGS.test(words.join(" "))
  );
}

/**
 * The events that already have minutes the reader can see (posted or a
 * draft) or notes they were added to, from the rows of each read.
 */
export function startedEventIds(
  ...lists: ReadonlyArray<readonly { event_id?: string | null }[] | undefined>
): Set<string> {
  const started = new Set<string>();
  for (const rows of lists) {
    for (const row of rows ?? []) {
      if (row.event_id) started.add(row.event_id);
    }
  }
  return started;
}

function endOf(event: CalendarMeeting): number {
  const start = Date.parse(event.start_time);
  const end = event.end_time ? Date.parse(event.end_time) : Number.NaN;
  return Number.isFinite(end) ? end : start + ASSUMED_LENGTH_MS;
}

/** What `minutesToWrite` finds on the calendar. */
export interface MinutesToWrite {
  /** Ended in the last 30 days with no minutes, newest first. */
  needs: CalendarMeeting[];
  /**
   * Ended in the last 30 days and marked "No minutes" by an officer
   * (`skipped`), newest first: settled, so they ask for nothing.
   */
  skipped: CalendarMeeting[];
  /** The soonest meeting in the coming week with none yet. */
  next: CalendarMeeting | null;
}

/**
 * The meetings that ended in the last 30 days with no minutes the reader can
 * see or take notes on, newest first, the ones of those an officer marked
 * "No minutes", and the next meeting in the coming week that has none yet.
 * `started` holds the event ids that already have minutes (posted or a
 * draft) or notes the reader was added to; `skipped` the event ids marked
 * "No minutes" (Paul, 2026-11-20: "can I say we don't have minutes? should
 * be a valid option"). Minutes started on a skipped meeting win.
 */
export function minutesToWrite(
  events: readonly CalendarMeeting[],
  started: ReadonlySet<string>,
  now: number,
  skipped: ReadonlySet<string> = new Set(),
): MinutesToWrite {
  const meetings = events.filter(
    (event) =>
      !!event?.id &&
      Number.isFinite(Date.parse(event.start_time)) &&
      isMeetingLikeName(event.name ?? "") &&
      !started.has(event.id),
  );
  const ended = meetings
    .filter((event) => {
      const start = Date.parse(event.start_time);
      return endOf(event) <= now && start >= now - NEEDS_MINUTES_DAYS * DAY_MS;
    })
    .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
  const next =
    meetings
      .filter((event) => {
        const start = Date.parse(event.start_time);
        return (
          !skipped.has(event.id) &&
          start > now &&
          start <= now + NEXT_UP_DAYS * DAY_MS
        );
      })
      .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time))[0] ??
    null;
  return {
    needs: ended.filter((event) => !skipped.has(event.id)),
    skipped: ended.filter((event) => skipped.has(event.id)),
    next,
  };
}
