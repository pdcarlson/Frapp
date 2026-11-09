import { parseInstant } from "@repo/formatting";
import { checkInWindowBounds } from "@repo/validation";

/**
 * When check-in closes, while that is still ahead; `null` once it has passed
 * or when the end time is unknown. Callers pass `useNow()`'s 30 s clock, so
 * a screen left open offers auto-absent within a tick of the close.
 *
 * The API refuses auto-absent until this instant
 * (`AttendanceService.markAutoAbsent`), from the same `checkInWindowBounds`
 * rule; offering the button earlier only produced that 400 (FRAPP-WEB-7,
 * #3905). The close depends on the end time alone, so the start passed here
 * is the end too.
 */
export function checkInClosesAt(eventEnd: unknown, now: number): Date | null {
  const end = parseInstant(eventEnd);
  if (!end) return null;
  const { closesAt } = checkInWindowBounds(end, end, undefined);
  return now < closesAt.getTime() ? closesAt : null;
}
