/**
 * Protected cluster 1 — stopwatch / timer padding.
 *
 * These format **elapsed seconds**, not instants. Folding them into
 * `formatLocaleDateTime` (or into each other) changes the on-screen clock.
 *
 * Two members stay distinct on purpose:
 * - {@link formatPaddedStopwatch} zero-pads minutes (`04:12`) — web study timer.
 * - {@link formatTimer} drops a meaningless leading zero (`4:12`) — mobile.
 *
 * Mobile also clamps negatives and floors partial seconds; web does not.
 */

/**
 * Seconds as a zero-padded stopwatch: `1:24:36` past the hour, `04:12` below it.
 *
 * Does not clamp negatives — the web study page's previous local helper did not.
 */
export function formatPaddedStopwatch(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Seconds as a stopwatch: `1:24:36` past the hour, `4:12` below it.
 *
 * Drops the hour segment below an hour rather than padding a meaningless zero.
 * Clamps negatives and floors partial seconds.
 */
export function formatTimer(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}
