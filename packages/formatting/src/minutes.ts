/**
 * Protected cluster 3 — minute-duration rounding.
 *
 * These format a **duration in minutes** as `2h 30m` / `45m`. They are not
 * elapsed-second stopwatches and not locale dates.
 *
 * Two members stay distinct on purpose:
 * - {@link formatMinutesExact} — no rounding; interpolates the number as-is.
 *   Web chat's hours card and the API's service-entry text.
 * - {@link formatMinutesRounded} — `Math.max(0, Math.round(minutes))`.
 *   Web's service and study hours (moved here 2026-11-05) and mobile's service
 *   hours, so those read the same total on either app. Mobile's study screen
 *   still formats its own way (`apps/mobile/lib/study/format.ts`, "2.1 hrs";
 *   #3420).
 *
 * Do not fold either into {@link formatPaddedStopwatch} / {@link formatTimer}
 * or into {@link formatLocaleDateTime}.
 */

/**
 * `150` → `"2h 30m"`, `45` → `"45m"`, `120` → `"2h"`.
 *
 * Fractional minutes below an hour pass through (`1.5` → `"1.5m"`).
 */
export function formatMinutesExact(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

/**
 * `150` → `"2h 30m"`, `45` → `"45m"`, `120` → `"2h"`.
 *
 * Rounds to the nearest whole minute and never renders a negative duration.
 */
export function formatMinutesRounded(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
