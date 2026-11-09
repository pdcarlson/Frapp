/**
 * Event date/window formatting and check-in state, shared by s06 (list), s07
 * (detail) and s18 (scanner).
 *
 * Pure and `now`-injected so the screens stay presentational and the states are
 * testable without freezing a clock. The window formatters are deliberately
 * separate from the relative labels in `components/chat/up-next-strip.tsx`:
 * that strip answers "how soon" in a one-line pulse ("Tomorrow 6:00 PM"), while
 * they answer "when and for how long" in a detail context ("Tonight · 6:00 –
 * 7:00 PM"). s06's day headings are `@repo/formatting`'s `formatDayHeading`.
 */

import { dayDelta, formatWeekdayDay, parseInstant } from "@repo/formatting";
import { checkInWindowBounds } from "@repo/validation";

function clock(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The detail header line: "Tonight · 6:00 – 7:00 PM", "Tomorrow · …",
 * "Sat, Mar 14 · …". Returns `""` for unparseable input rather than the string
 * "Invalid Date", which is what `toLocaleString` would otherwise render on
 * screen.
 */
export function formatEventWindow(
  startTime: string,
  endTime: string,
  now: Date,
): string {
  const start = parseInstant(startTime);
  if (!start) return "";
  const end = parseInstant(endTime);

  const days = dayDelta(now, start);
  let day: string;
  if (days === 0) {
    // "Tonight" only when it reads true; a 9am meeting today is not tonight.
    day = start.getHours() >= 17 ? "Tonight" : "Today";
  } else if (days === 1) {
    day = "Tomorrow";
  } else if (days > 1 && days < 7) {
    day = start.toLocaleDateString(undefined, { weekday: "long" });
  } else {
    day = start.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  const time = end ? `${clock(start)} – ${clock(end)}` : clock(start);
  return `${day} · ${time}`;
}

export type CheckInWindowState =
  /** Before check-in opens (the event's lead before `start_time`). */
  | "upcoming"
  /** From the lead before `start_time` to `end_time + grace` — the only state that checks in. */
  | "open"
  /** Past the grace period. */
  | "closed"
  /** Unparseable times; the screen must not offer a check-in it cannot reason about. */
  | "unknown";

export interface CheckInWindow {
  state: CheckInWindowState;
  /** When check-in stops being accepted, for the "closes 6:15" line. */
  closesAt: Date | null;
  /** When check-in opens, for "Check-in opens at 7:50 PM" on an upcoming event. */
  opensAt: Date | null;
}

/**
 * Where an event is in its check-in window. The window is
 * `@repo/validation`'s `checkInWindowBounds`, the rule the server enforces:
 * it opens `opensMinutes` before the start (the event's
 * `check_in_opens_minutes`; a missing value reads as the default 10) and
 * closes 15 minutes after the end. The server rejects a check-in outside it
 * whatever this says; this only stops the UI offering one.
 */
export function resolveCheckInWindow(
  startTime: string,
  endTime: string,
  now: Date,
  opensMinutes?: unknown,
): CheckInWindow {
  const start = parseInstant(startTime);
  const end = parseInstant(endTime);
  if (!start || !end) {
    return { state: "unknown", closesAt: null, opensAt: null };
  }

  const { opensAt, closesAt } = checkInWindowBounds(start, end, opensMinutes);
  if (now < opensAt) return { state: "upcoming", closesAt, opensAt };
  if (now > closesAt) return { state: "closed", closesAt, opensAt };
  return { state: "open", closesAt, opensAt };
}

/**
 * "at 7:50 PM" today, "tomorrow at 7:50 PM", "Friday at 7:50 PM" within the
 * week (the detail header's own day word, so the screen agrees with itself),
 * otherwise "Fri, Nov 13 at 7:50 PM" (`formatWeekdayDay`, with the year
 * outside the current one): when an upcoming event's check-in opens, for the
 * one line its card says (#3703). The day is said whenever it isn't today,
 * because "opens at 7:50 PM" on next week's meeting reads as tonight.
 *
 * A sentence fragment, which none of `@repo/formatting`'s row labels
 * ("Tomorrow · 7:50 PM") can be, so it is built here from their parts; it is
 * one of mobile's date copies #3420 folds into the shared helpers.
 */
export function formatCheckInOpens(opensAt: Date, now: Date): string {
  const time = clock(opensAt);
  const days = dayDelta(now, opensAt);
  if (days === 0) return `at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  const day =
    days > 1 && days < 7
      ? opensAt.toLocaleDateString(undefined, { weekday: "long" })
      : formatWeekdayDay(opensAt.toISOString(), now);
  return `${day} at ${time}`;
}

/**
 * "closes 6:15" / "opens 5:45" — the trailing clause drawn on the s07 card.
 *
 * Deliberately NOT `formatClock`: `@repo/formatting` exports a `formatClock`
 * that renders `"Mar 5, 6:15 PM"` — date included. That package is a declared
 * dependency of `apps/mobile`, so its version is one auto-import away from any
 * file here, and under the old name the two renderings sat one identifier apart
 * with nothing to tell them apart at the call site. Picking the wrong one
 * produces plausible, silently wrong copy rather than an error.
 */
export function formatEventClock(date: Date | null): string {
  return date ? clock(date) : "";
}

/** `mm:ss` for the s22 rotation countdown. Clamped at zero: a negative
 * countdown means the refetch is late, and "-0:03" reads as broken. */
export function formatCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.floor(msRemaining / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Sort ascending by start, dropping rows with no usable start time. */
export function sortEventsByStart<T extends { start_time?: unknown }>(
  events: T[],
): T[] {
  return events
    .map((event) => ({
      event,
      // `parseInstant` is the narrowing too: a non-string `start_time` is a
      // non-value, the same as an unreadable one.
      at: parseInstant(event.start_time),
    }))
    .filter((entry): entry is { event: T; at: Date } => entry.at !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((entry) => entry.event);
}

/**
 * Whether an event is worth showing on the list: still ahead, or recent enough
 * that its check-in window has not closed. A chapter's history belongs in
 * reports, not in the member-facing list.
 */
export function isCurrentOrUpcoming(
  startTime: string,
  endTime: string,
  now: Date,
): boolean {
  return resolveCheckInWindow(startTime, endTime, now).state !== "closed";
}
