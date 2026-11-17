import { checkInWindowBounds } from "./check-in-window";

/**
 * Which meeting a set of minutes starts on (`spec/behavior/meetings.md`
 * § Writing minutes by hand, § Recording in the app). Every set of minutes
 * belongs to an event (#4935), so starting them, on the web's New minutes or
 * the phone's +, first picks one. Pure: no React, no query.
 */

/** The fields this module reads off an event row. */
export type MeetingEventLike = {
  id: string;
  name: string;
  start_time: string;
  end_time?: string | null;
  check_in_opens_minutes?: number | null;
};

/** The name a meeting gets when the officer types none (#5219). */
export const DEFAULT_MEETING_NAME = "Chapter meeting";

/**
 * How long a meeting made by the phone's + runs before anyone changes it,
 * the same hour web's New minutes gives a meeting with no end typed.
 */
export const NEW_MEETING_MINUTES = 60;

/**
 * A Standards hearing has no minutes in Frapp: it is never recorded and never
 * drafted, and its minutes are written by hand outside Frapp (§ Standards
 * meetings). The phone's + neither picks nor lists an event whose name reads
 * as one, so one tap can't land on a hearing.
 */
const HEARING_NAME = /\bstandards?\b|\bhearing\b|\bj[- ]?board\b/i;

export function looksLikeHearing(name: string): boolean {
  return HEARING_NAME.test(name);
}

/** Whether `event`'s check-in window is open at `now`: the meeting is on. */
export function meetingIsOn(event: MeetingEventLike, now: number): boolean {
  const start = new Date(event.start_time);
  const end = new Date(event.end_time ?? "");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return false;
  }
  // "On" is its check-in window, as the live-meeting card reads it.
  const { opensAt, closesAt } = checkInWindowBounds(
    start,
    end,
    event.check_in_opens_minutes,
  );
  return opensAt.getTime() <= now && now <= closesAt.getTime();
}

/**
 * The meeting New minutes opens on (#5219): one on now, else the newest one
 * that has started and has no minutes. Null when every recent one has them.
 */
export function likelyMeeting<T extends MeetingEventLike>(
  events: readonly T[],
  withMinutes: ReadonlySet<string>,
  now: number,
): T | null {
  const open = events.filter((event) => !withMinutes.has(event.id));
  const on = open.find((event) => meetingIsOn(event, now));
  if (on) return on;
  return (
    open
      .filter((event) => Date.parse(event.start_time) <= now)
      .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time))[0] ??
    null
  );
}

/**
 * The meeting in the room now, as the phone's Record meeting and New minutes
 * read it (#5287): one whose check-in window is open. Of two, the one whose
 * start is nearest now, so the meeting about to start beats the one that
 * just ended within its grace, and a short meeting beats an all-day event
 * whose window spans it. Never a hearing.
 *
 * Null means nothing on the calendar is in the room right now. Whether the
 * meeting already has minutes is the caller's to say.
 */
export function meetingInTheRoom<T extends MeetingEventLike>(
  events: readonly T[],
  now: number,
): T | null {
  const distance = (event: T) => Math.abs(Date.parse(event.start_time) - now);
  return (
    events
      .filter(
        (event) => !looksLikeHearing(event.name) && meetingIsOn(event, now),
      )
      .sort((a, b) => distance(a) - distance(b))[0] ?? null
  );
}

/**
 * The quiet event a meeting that isn't on the calendar gets when its minutes
 * start today with no times typed (§ Writing minutes by hand): starting now
 * rounded down to five minutes, so members can check in while it runs, for
 * {@link NEW_MEETING_MINUTES}. The phone's + uses it, and so does web's New
 * minutes (`offCalendarSpan`).
 */
export function meetingStartingNow(now: Date): {
  start_time: string;
  end_time: string;
} {
  const start = new Date(now);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() - (start.getMinutes() % 5));
  return {
    start_time: start.toISOString(),
    end_time: new Date(
      start.getTime() + NEW_MEETING_MINUTES * 60_000,
    ).toISOString(),
  };
}
