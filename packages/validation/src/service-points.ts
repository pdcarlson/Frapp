/**
 * Service-hours points math, shared by the API's approve path
 * (`ServiceEntryService.approve`) and the web review queue's preview of what
 * Approve will award (#3862). One function so the preview can't round
 * differently from the ledger insert it predicts.
 *
 * Rule: `spec/behavior/service-hours.md` § Approval Workflow.
 */

/**
 * Minutes of approved service per SERVICE point when a chapter has no
 * `chapter_service_config` row. Mirrors the column default (migration
 * 20260809124500).
 */
export const SERVICE_MINUTES_PER_POINT_DEFAULT = 60;

/**
 * The rate actually applied. The column's CHECK keeps it at least 1, but a
 * value from before the constraint, a hand-edited row, or a missing config
 * would otherwise divide by zero or by `undefined`, so anything that is not a
 * whole number of at least 1 falls back to the default.
 */
export function effectiveMinutesPerPoint(minutesPerPoint: unknown): number {
  return typeof minutesPerPoint === "number" &&
    Number.isInteger(minutesPerPoint) &&
    minutesPerPoint >= 1
    ? minutesPerPoint
    : SERVICE_MINUTES_PER_POINT_DEFAULT;
}

/**
 * SERVICE points an approval awards: whole points only, rounded down, so a
 * duration under the rate awards 0 (and approves with no ledger row).
 */
export function servicePointsForDuration(
  durationMinutes: number,
  minutesPerPoint: unknown,
): number {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return 0;
  return Math.floor(
    durationMinutes / effectiveMinutesPerPoint(minutesPerPoint),
  );
}
