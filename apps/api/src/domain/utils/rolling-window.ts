/**
 * Rolling-window ceilings (`domain/constants/daily-send-limits.ts`): given
 * when each counted write happened, whether `needed` more fit under `limit`
 * now, and if not, when they will.
 */

export interface RollingWindowRoom {
  /** How many more fit now, never below 0. */
  remaining: number;
  /**
   * `null` when `needed` more fit now. Otherwise when enough of the counted
   * writes have aged out of the window for them to fit.
   */
  roomAt: Date | null;
}

/**
 * `times` are the counted writes' timestamps, any order; ones older than the
 * window are ignored. `needed` above `limit` never fits, and reads as room
 * once every counted write has aged out, the soonest anything could change.
 */
export function rollingWindowRoom(
  times: readonly (string | Date)[],
  limit: number,
  needed: number,
  now: Date,
  windowMs: number,
): RollingWindowRoom {
  const since = now.getTime() - windowMs;
  const inWindow = times
    .map((time) => new Date(time).getTime())
    .filter((ms) => Number.isFinite(ms) && ms > since)
    .sort((a, b) => a - b);
  const remaining = Math.max(0, limit - inWindow.length);
  const over = inWindow.length + needed - limit;
  if (over <= 0) return { remaining, roomAt: null };
  // The `over` oldest must age out; the last of them leaves at its time plus
  // the window.
  const leaving = inWindow[Math.min(over, inWindow.length) - 1];
  return { remaining, roomAt: new Date(leaving + windowMs) };
}

/**
 * How long until `at`, in the words a refusal uses: "about a minute",
 * "about 20 minutes", "about an hour", "about 5 hours". Rounded up, so a
 * member who waits as long as it says finds room.
 */
export function waitPhrase(at: Date, now: Date): string {
  const minutes = Math.max(
    1,
    Math.ceil((at.getTime() - now.getTime()) / 60_000),
  );
  if (minutes < 60) {
    return minutes === 1 ? 'about a minute' : `about ${minutes} minutes`;
  }
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? 'about an hour' : `about ${hours} hours`;
}
