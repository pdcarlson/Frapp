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
 * How long after it started a meeting still counts as the one in the room
 * when its check-in window says nothing (no end, or an end already past).
 */
const STILL_ON_MS = 60 * 60_000;

/** How long a meeting made by the phone's + runs before anyone changes it. */
const NEW_MEETING_MS = 60 * 60_000;

/**
 * A hearing is never picked on the officer's behalf: a Standards meeting is
 * never recorded and never drafted (§ Standards meetings), so one tap must not
 * land on one. The officer can still pick it by hand to write it.
 */
const HEARING_NAME = /\bstandards?\b|\bhearing\b|\bj[- ]?board\b/i;

export function looksLikeHearing(name: string): boolean {
  return HEARING_NAME.test(name);
}

function isOnNow(event: MeetingEventLike, now: number): boolean {
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
  const on = open.find((event) => isOnNow(event, now));
  if (on) return on;
  return (
    open
      .filter((event) => Date.parse(event.start_time) <= now)
      .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time))[0] ??
    null
  );
}

/**
 * The meeting the phone's Record meeting and New minutes pick by themselves
 * (#5287): one happening now, which is a meeting whose check-in window is
 * open or that started within the last hour. Of two, the one that started
 * first. Never a hearing. `blocked` holds events whose minutes someone else
 * started, which this member can't open as theirs.
 *
 * Null means "a new meeting, today": nothing on the calendar is in the room
 * right now, and an older event is a choice the officer makes, not a guess.
 */
export function meetingInTheRoom<T extends MeetingEventLike>(
  events: readonly T[],
  blocked: ReadonlySet<string>,
  now: number,
): T | null {
  const candidates = events.filter((event) => {
    if (blocked.has(event.id) || looksLikeHearing(event.name)) return false;
    const start = Date.parse(event.start_time);
    if (Number.isNaN(start) || start > now + STILL_ON_MS) return false;
    return isOnNow(event, now) || (start <= now && now - start <= STILL_ON_MS);
  });
  return (
    [...candidates].sort(
      (a, b) => Date.parse(a.start_time) - Date.parse(b.start_time),
    )[0] ?? null
  );
}

/**
 * The quiet event a meeting that isn't on the calendar gets when the phone
 * starts its minutes (§ Writing minutes by hand): today, starting now rounded
 * down to five minutes so members can check in while it runs, for an hour.
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
    end_time: new Date(start.getTime() + NEW_MEETING_MS).toISOString(),
  };
}
