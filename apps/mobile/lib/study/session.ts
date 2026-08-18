/**
 * Narrowing and derivation for `GET /v1/study-sessions` and every study-session
 * mutation, over a route that ships no OpenAPI response schema (so the SDK
 * types its body `never` — the wall `lib/more/narrow.ts` documents).
 *
 * ## The rule this module exists to enforce
 *
 * **A study session ends by returning 200, not by throwing.** Expiry is lazy
 * server-side (`spec/behavior/study-sessions.md`: "there is no sweeper. Every
 * entry point … resolves a lapsed pause before doing anything else"), so a
 * pause, resume, heartbeat or stop can each come back carrying
 * `PAUSED_EXPIRED`, `EXPIRED` or `LOCATION_INVALID`. A client that only inspects
 * its `catch` block keeps a dead session on screen, ticking, forever.
 * `settleIfEnded` is the single place that check lives.
 *
 * ## And the rule about the clock
 *
 * `patterns.md` § Study sessions: "Credited time derives from server-recorded
 * timestamps, never an accumulated client-side timer — a clock the client owns
 * is a clock the client can inflate." So {@link creditedSeconds} reproduces the
 * server's own arithmetic rather than counting: `total_foreground_minutes` is
 * credited up to the `last_heartbeat_at` watermark, and the only thing added
 * locally is the wall-clock gap since that watermark. Nothing accumulates
 * across a pause, because the watermark stops moving.
 */
import { isRecord, num, records, str } from "../more/narrow";

export type StudySessionStatus =
  | "ACTIVE"
  | "COMPLETED"
  | "EXPIRED"
  | "PAUSED_EXPIRED"
  | "LOCATION_INVALID";

export interface StudySessionModel {
  id: string;
  geofenceId: string | null;
  status: StudySessionStatus;
  startTime: string;
  endTime: string | null;
  /** Credit watermark: foreground time is banked up to here, not to `now`. */
  lastHeartbeatAt: string;
  /** Set while backgrounded. Pause is a sub-state of ACTIVE, not a status. */
  pausedAt: string | null;
  totalForegroundMinutes: number;
  pointsAwarded: boolean;
}

const STATUSES: ReadonlySet<string> = new Set<StudySessionStatus>([
  "ACTIVE",
  "COMPLETED",
  "EXPIRED",
  "PAUSED_EXPIRED",
  "LOCATION_INVALID",
]);

/**
 * The four statuses a session cannot leave.
 *
 * `ACTIVE` is the only non-terminal one — and a *paused* session is still
 * ACTIVE, which is why pausing is read off `pausedAt` and never off `status`.
 */
export const TERMINAL_STATUSES: ReadonlySet<StudySessionStatus> = new Set<
  StudySessionStatus
>(["COMPLETED", "EXPIRED", "PAUSED_EXPIRED", "LOCATION_INVALID"]);

export function isTerminal(status: StudySessionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isPaused(session: StudySessionModel): boolean {
  return session.status === "ACTIVE" && session.pausedAt !== null;
}

/** One session row, or `null` when it cannot be drawn honestly. */
export function narrowSession(data: unknown): StudySessionModel | null {
  if (!isRecord(data)) return null;
  const id = str(data, "id");
  const rawStatus = str(data, "status");
  const startTime = str(data, "start_time");
  if (!id || !rawStatus || !STATUSES.has(rawStatus) || !startTime) return null;

  return {
    id,
    geofenceId: str(data, "geofence_id"),
    status: rawStatus as StudySessionStatus,
    startTime,
    endTime: str(data, "end_time"),
    // The watermark defaults to the start instant, which is what the server
    // stamps on create — so a session that has not heartbeat yet still credits
    // from the right moment rather than from the epoch.
    lastHeartbeatAt: str(data, "last_heartbeat_at") ?? startTime,
    pausedAt: str(data, "paused_at"),
    totalForegroundMinutes: num(data, "total_foreground_minutes") ?? 0,
    pointsAwarded: data.points_awarded === true,
  };
}

/** Every readable session, newest first. */
export function selectSessions(data: unknown): StudySessionModel[] {
  return records(data)
    .map(narrowSession)
    .filter((row): row is StudySessionModel => !!row)
    .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
}

/**
 * The one live session, if there is one.
 *
 * The server enforces at most one (`start` returns 409 otherwise) and settles
 * lapsed pauses on every read, so anything still `ACTIVE` in a fresh list is
 * genuinely live. This is what lets s10 recover a session across an app
 * relaunch, which the web screen never needed to do.
 */
export function selectActiveSession(data: unknown): StudySessionModel | null {
  return selectSessions(data).find((row) => row.status === "ACTIVE") ?? null;
}

/** Finished sessions, newest first — the drawn history list. */
export function selectSessionHistory(data: unknown): StudySessionModel[] {
  return selectSessions(data).filter((row) => isTerminal(row.status));
}

/**
 * Seconds of credited foreground time, mirroring the server's own model.
 *
 * Paused and terminal sessions report exactly what the server has banked. A
 * running one adds the gap since the watermark, which is the same span the next
 * heartbeat will convert into whole minutes — so the number never runs ahead of
 * what the member will actually be paid for.
 */
export function creditedSeconds(
  session: StudySessionModel,
  now: Date,
): number {
  const banked = session.totalForegroundMinutes * 60;
  if (session.pausedAt !== null || isTerminal(session.status)) return banked;

  const watermark = Date.parse(session.lastHeartbeatAt);
  if (Number.isNaN(watermark)) return banked;
  const sinceWatermark = Math.max(0, (now.getTime() - watermark) / 1000);
  // Clamped at the server's stale-heartbeat window. Past it the server does not
  // credit the gap — it voids the session — so an unclamped clock would tick
  // smoothly up to `0:47:00` for a member in a basement whose heartbeats have
  // all failed, and then pay them nothing. `isStale` is what the screen uses to
  // say so out loud; this only stops the number itself from lying.
  return banked + Math.min(sinceWatermark, HEARTBEAT_STALE_SECONDS);
}

/** `spec/behavior/study-sessions.md`: no heartbeat for 10 minutes voids a session. */
export const HEARTBEAT_STALE_SECONDS = 10 * 60;

/**
 * True once the server has heard nothing for long enough to be at risk of
 * voiding the session.
 *
 * Deliberately shorter than the 10-minute void: one missed 5-minute heartbeat
 * is worth telling the member about while they can still walk somewhere with
 * signal, and by the time the window has actually lapsed it is too late.
 * Meaningless for a paused or closed session, which is why both return false.
 */
export function isReportingStale(
  session: StudySessionModel,
  now: Date,
): boolean {
  if (session.pausedAt !== null || isTerminal(session.status)) return false;
  const watermark = Date.parse(session.lastHeartbeatAt);
  if (Number.isNaN(watermark)) return false;
  return now.getTime() - watermark > 6 * 60 * 1000;
}

/**
 * Whether a response ended the session the screen is holding, and the notice to
 * show if so.
 *
 * The id comparison is not defensive noise: a pause fired as the app
 * backgrounds can land *after* the member has returned and started a new
 * session, and without this guard its terminal body would wipe the live one.
 * The web screen hit exactly that and guards the same way.
 */
export function settleIfEnded(
  response: unknown,
  activeSessionId: string | null,
): { ended: true; notice: string; session: StudySessionModel } | { ended: false } {
  const session = narrowSession(response);
  if (!session || !isTerminal(session.status)) return { ended: false };
  if (activeSessionId !== null && session.id !== activeSessionId) {
    return { ended: false };
  }
  return { ended: true, notice: endedNotice(session), session };
}

/**
 * Why a session ended, in the member's terms.
 *
 * `writing.md` §Errors wants what happened, why, and what is next — and these
 * are not all failures: `COMPLETED` and `PAUSED_EXPIRED` both award points
 * (`study-sessions.md` § Points Award), so only two of the four read as a loss.
 */
export function endedNotice(session: StudySessionModel): string {
  switch (session.status) {
    case "COMPLETED":
      return "Session ended. Your points are on the way once the chapter's minimum session length is met.";
    case "PAUSED_EXPIRED":
      return "Session closed while the app was in the background. You kept the time you studied before it paused.";
    case "EXPIRED":
      return "Session ended: you left the study zone, or the app stopped reporting for 10 minutes. No points were awarded.";
    case "LOCATION_INVALID":
      return "Session ended: your location couldn't be read accurately enough to confirm you were in the zone. No points were awarded.";
    default:
      return "Session ended.";
  }
}
