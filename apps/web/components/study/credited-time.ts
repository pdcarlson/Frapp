/**
 * Credited-time arithmetic for the web study screen.
 *
 * Mobile already owns this in `apps/mobile/lib/study/session.ts`. Web must not
 * import that tree. The numbers must still match: a clock the client owns is a
 * clock the client can inflate (`spec/ui/mobile/patterns.md` § Study
 * sessions). Sharing the two copies is a follow-up, not a reason to drift.
 */

const TERMINAL = new Set([
  "COMPLETED",
  "EXPIRED",
  "PAUSED_EXPIRED",
  "LOCATION_INVALID",
]);

/** `spec/behavior/study-sessions.md`: no heartbeat for 10 minutes voids a session. */
export const HEARTBEAT_STALE_SECONDS = 10 * 60;

export function selectActiveSession<T extends { status: string }>(
  sessions: T[],
): T | null {
  return sessions.find((row) => row.status === "ACTIVE") ?? null;
}

/**
 * Seconds of credited foreground time, mirroring the server's model.
 *
 * Banked minutes sit at the `last_heartbeat_at` watermark. A running session
 * adds the wall-clock gap since that watermark, clamped at the stale window
 * so a basement with no GPS does not tick toward a number the server will
 * never pay. Paused and terminal sessions report the banked total only.
 */
export function creditedSeconds(
  session: {
    status: string;
    start_time: string;
    last_heartbeat_at: string | null;
    paused_at: string | null;
    total_foreground_minutes: number;
  },
  now: Date,
): number {
  const banked = session.total_foreground_minutes * 60;
  if (session.paused_at !== null || TERMINAL.has(session.status)) return banked;

  const watermark = Date.parse(session.last_heartbeat_at ?? session.start_time);
  if (Number.isNaN(watermark)) return banked;
  const sinceWatermark = Math.max(0, (now.getTime() - watermark) / 1000);
  return banked + Math.min(sinceWatermark, HEARTBEAT_STALE_SECONDS);
}
