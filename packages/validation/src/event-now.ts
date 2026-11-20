import { checkInWindowBounds } from "./check-in-window";

/**
 * Whether an event is on: the one rule every "now" surface reads
 * (`spec/behavior/activity.md` § Now, #5777).
 *
 * An event is on from when its check-in opens (never later than its start)
 * until its end. Checking in doesn't end it: Paul sat in a meeting he had
 * checked in to and no screen said it was on, because Activity counted the
 * check-in as the event being done and Chat's Up next had moved on to the
 * next start (2026-11-19). The end is exclusive, so a 9:25 – 10:25 meeting is
 * off at 10:25; the 15 minutes of check-in grace after it are not "on".
 *
 * `now` is epoch ms. Times that don't parse are never on.
 */
export function eventOnAt(
  start: unknown,
  end: unknown,
  opensMinutes: unknown,
  now: number,
): boolean {
  const from = typeof start === "string" ? new Date(start) : null;
  const to = typeof end === "string" ? new Date(end) : null;
  if (!from || !to) return false;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return false;
  const { opensAt } = checkInWindowBounds(from, to, opensMinutes);
  return opensAt.getTime() <= now && now < to.getTime();
}

/** The most events the Now read serves; a card shows one and counts the rest. */
export const EVENTS_NOW_LIMIT = 5;

/**
 * The words on the Now card and the event's pill, both apps. Indicates, never
 * narrates (Paul, 2026-11-20): "Now · until 10:25 PM", not "This event is
 * happening now, tap to check in". `clock` is the caller's formatted time.
 */
export const EVENT_NOW_COPY = {
  until: (clock: string) => `Now · until ${clock}`,
  ended: (clock: string) => `Ended ${clock}`,
  checkedIn: (clock?: string | null) =>
    clock ? `Checked in ${clock}` : "Checked in",
  checkIn: "Check in",
  more: (count: number) => `+${count} more on now`,
} as const;
