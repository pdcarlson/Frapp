import { formatMinutesRounded } from "@repo/formatting";
import {
  effectiveMinutesPerPoint,
  servicePointsForDuration,
} from "@repo/validation";

/**
 * The review queue's line saying what Approve will award (#3862), from the
 * same math the API's approve path uses (`servicePointsForDuration`).
 *
 * The rate is read when the officer clicks, not when the page loaded
 * (`spec/behavior/service-hours.md` § Approval Workflow), so the line names
 * it as the chapter's *current* rate rather than promising a number.
 *
 * Returns `null` when the rate isn't known — the chapter config is still
 * loading, failed, or the viewer lacks `chapter-config:view`. Guessing the
 * default there would state a number the server may not award.
 */
export function approvePointsPreview(
  durationMinutes: number,
  minutesPerPoint: number | null | undefined,
): string | null {
  if (minutesPerPoint === null || minutesPerPoint === undefined) return null;
  const rate = effectiveMinutesPerPoint(minutesPerPoint);
  const per = rate === 60 ? "hour" : formatMinutesRounded(rate);
  const points = servicePointsForDuration(durationMinutes, rate);
  if (points === 0) {
    return `Approving awards no points: ${formatMinutesRounded(durationMinutes)} is under the chapter's rate of 1 point per ${per}.`;
  }
  return `Approving awards ${points} service ${points === 1 ? "point" : "points"}, at the chapter's current rate of 1 per ${per}.`;
}
