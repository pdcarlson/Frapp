/**
 * Event date/window formatting and check-in state, shared by s06 (list), s07
 * (detail) and s18 (scanner).
 *
 * Pure and `now`-injected so the screens stay presentational and the states are
 * testable without freezing a clock. Deliberately separate from the relative
 * labels in `components/chat/up-next-strip.tsx`: that strip answers "how soon"
 * in a one-line pulse ("tmrw 6:00 PM"), while these answer "when and for how
 * long" in a detail context ("Tonight · 6:00 – 7:00 PM"). Merging them would
 * force one of the two surfaces to render the wrong register.
 */

/**
 * Grace minutes after `end_time` during which check-in stays open.
 *
 * Mirrors `CHECK_IN_GRACE_PERIOD_MINUTES` in
 * `apps/api/src/application/services/attendance.service.ts`, which is the
 * authority — the server enforces the window on every surface and rejects a
 * late check-in regardless of what this client believes. This copy exists only
 * so the UI can stop *offering* a check-in it knows will fail; it never grants
 * one. `spec/behavior/events.md` documents the 15-minute default.
 */
export const CHECK_IN_GRACE_MINUTES = 15;

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayDelta(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}

function clock(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** `Invalid Date` guard — the API can hand back anything a bad write stored. */
function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
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
  const start = parse(startTime);
  if (!start) return "";
  const end = parse(endTime);

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

/** The s06 row label — shorter, since the row already carries the event name. */
export function formatEventRowTime(startTime: string, now: Date): string {
  const start = parse(startTime);
  if (!start) return "";
  const days = dayDelta(now, start);
  if (days === 0) return `Today · ${clock(start)}`;
  if (days === 1) return `Tomorrow · ${clock(start)}`;
  if (days > 1 && days < 7) {
    return `${start.toLocaleDateString(undefined, { weekday: "long" })} · ${clock(start)}`;
  }
  return `${start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} · ${clock(start)}`;
}

export type CheckInWindowState =
  /** Before `start_time`. */
  | "upcoming"
  /** Between `start_time` and `end_time + grace` — the only state that checks in. */
  | "open"
  /** Past the grace period. */
  | "closed"
  /** Unparseable times; the screen must not offer a check-in it cannot reason about. */
  | "unknown";

export interface CheckInWindow {
  state: CheckInWindowState;
  /** When check-in stops being accepted, for the "closes 6:15" line. */
  closesAt: Date | null;
  /** When check-in starts, for the "opens 5:45" line on an upcoming event. */
  opensAt: Date | null;
}

export function resolveCheckInWindow(
  startTime: string,
  endTime: string,
  now: Date,
): CheckInWindow {
  const start = parse(startTime);
  const end = parse(endTime);
  if (!start || !end) {
    return { state: "unknown", closesAt: null, opensAt: null };
  }

  const closesAt = new Date(end.getTime() + CHECK_IN_GRACE_MINUTES * MS_PER_MINUTE);
  if (now < start) return { state: "upcoming", closesAt, opensAt: start };
  if (now > closesAt) return { state: "closed", closesAt, opensAt: start };
  return { state: "open", closesAt, opensAt: start };
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
      at: parse(typeof event.start_time === "string" ? event.start_time : null),
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
