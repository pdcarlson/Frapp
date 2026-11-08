/**
 * When an event takes check-ins (`spec/behavior/events.md` § Check-In): from
 * `check_in_opens_minutes` before `start_time` until `CHECK_IN_GRACE_MINUTES`
 * after `end_time`.
 *
 * One copy for every surface. The API enforces this window; mobile's event
 * screens and both apps' chat event cards read it only to stop offering a
 * check-in the server would refuse. They used to keep their own copies of the
 * grace (three of them), which is how a rule drifts.
 */

/** Minutes after `end_time` during which check-in stays open. */
export const CHECK_IN_GRACE_MINUTES = 15;

/**
 * Minutes before `start_time` that check-in opens when the event doesn't say.
 * Members arrive early; a window that opened at the start time turned the
 * first five minutes of chapter into a queue (#3703).
 */
export const DEFAULT_CHECK_IN_OPENS_MINUTES = 10;

/**
 * The most an officer may open check-in ahead of the start. Two hours covers
 * a long pre-event (setup, a tailgate) without letting a typo open a
 * meeting's check-in the day before.
 */
export const MAX_CHECK_IN_OPENS_MINUTES = 120;

const MS_PER_MINUTE = 60 * 1000;

/**
 * The event's own lead, or the default for a row or card written before the
 * column existed (or carrying a value no server would have stored).
 */
export function checkInOpensMinutes(value: unknown): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_CHECK_IN_OPENS_MINUTES
    ? value
    : DEFAULT_CHECK_IN_OPENS_MINUTES;
}

export interface CheckInWindowBounds {
  /** The first instant a check-in is accepted. */
  opensAt: Date;
  /** The last instant a check-in is accepted. */
  closesAt: Date;
}

/**
 * The window for an event's parsed start and end. `opensMinutes` goes through
 * {@link checkInOpensMinutes}, so callers pass the raw field.
 */
export function checkInWindowBounds(
  start: Date,
  end: Date,
  opensMinutes: unknown,
): CheckInWindowBounds {
  return {
    opensAt: new Date(
      start.getTime() - checkInOpensMinutes(opensMinutes) * MS_PER_MINUTE,
    ),
    closesAt: new Date(end.getTime() + CHECK_IN_GRACE_MINUTES * MS_PER_MINUTE),
  };
}
