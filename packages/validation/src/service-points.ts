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

/** The fields of a service entry {@link awardedPointsLabel} reads. */
export interface AwardedPointsSource {
  status: string;
  points_awarded: boolean;
  /** Absent from a response served before #3868, `null` until approved. */
  awarded_points?: number | null;
}

/**
 * What a reviewed entry's History row says about its points (#3868): the
 * number its approval recorded (`3 points`, `1 point`), `No points` for a
 * sub-rate approval, or `null` for an entry that awarded nothing to show
 * (pending or rejected). The number is the one the approval wrote, never
 * recomputed from today's rate.
 *
 * Falls back to `Points awarded` when the entry was awarded but carries no
 * number: an approval whose ledger row was gone when the column was
 * backfilled, or an API older than the field.
 *
 * Shared by web's History list and mobile's Service hours rows so the two
 * read the same. Copy: `spec/ui/design-system/writing.md` § Service Hours.
 */
export function awardedPointsLabel(entry: AwardedPointsSource): string | null {
  const points = entry.awarded_points;
  if (
    typeof points === "number" &&
    Number.isInteger(points) &&
    points >= 0 &&
    (entry.status === "APPROVED" || entry.points_awarded)
  ) {
    if (points === 0) return "No points";
    return `${points} ${points === 1 ? "point" : "points"}`;
  }
  return entry.points_awarded ? "Points awarded" : null;
}
