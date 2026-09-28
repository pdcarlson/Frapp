/**
 * Study-session failures, in the member's terms.
 *
 * Every branch here is a real server response, not a defensive guess — the
 * messages come from `StudyService` and the guard chain above it. Kept out of
 * the screen and unit-tested for the reason `apps/web`'s equivalent gives: an
 * error-shape change is silent, and this mapping is where it would land.
 *
 * `writing.md` §Errors: name what failed, why, and what to do next. A bare
 * relay of the server string does the first two and never the third, so the
 * cases a member can actually act on get their own copy.
 */

import { serverMessageOf, statusOf } from "@repo/api-sdk";
import { moduleRefusalOf } from "@/lib/module-refusal";
import {
  SUBSCRIPTION_REFUSAL_COPY,
  subscriptionRefusalOf,
} from "@/lib/subscription-refusal";

export { serverMessageOf, statusOf };

/**
 * Member copy for the module gate (`writing.md` § Study session (mobile,
 * s10), the "Module off" rows).
 *
 * The guard's own message tells an officer to "Re-enable it in Settings →
 * Modules", which a member can't do, so neither function below may let it
 * reach the relaying 403 arm.
 */
export const MODULE_OFF_COPY = {
  start:
    "Your chapter isn't tracking study hours right now. An officer can turn the module back on.",
  /**
   * A session that is already running when an officer switches `hours` off.
   * Pause, resume, heartbeat and stop are refused by the same gate, so this
   * follows `SUBSCRIPTION_REFUSAL_COPY.studySession`: the session stays
   * active server-side and a session whose heartbeats are refused expires
   * with nothing credited, so it neither promises the time nor says it's
   * gone.
   */
  session:
    "Your chapter isn't tracking study hours right now, so that didn't save. An officer can turn the module back on — study time tracked now may not be credited.",
} as const;

/**
 * The member copy for a refusal nothing on this device can clear, or `null`.
 *
 * Two gates refuse study writes permanently: the subscription gate and the
 * module gate. A caller that retries on failure (the pause/resume mirror) or
 * swallows failures as transient (the heartbeat) must stop and say so for
 * both, so the screen asks this once instead of naming each gate.
 */
export function permanentRefusalCopy(
  error: unknown,
  path: "start" | "session",
): string | null {
  if (subscriptionRefusalOf(error)) {
    return path === "start"
      ? SUBSCRIPTION_REFUSAL_COPY.study
      : SUBSCRIPTION_REFUSAL_COPY.studySession;
  }
  if (moduleRefusalOf(error)) {
    return path === "start" ? MODULE_OFF_COPY.start : MODULE_OFF_COPY.session;
  }
  return null;
}

/**
 * A 409 from `POST /start` means a genuinely live session, never a stale one.
 *
 * The server settles a lapsed pause before it checks — `study-sessions.md`
 * says `start` doing so "is what keeps an abandoned session from 409-ing a
 * member out of ever starting another one". So the screen's response to this is
 * to refetch and adopt the session it already has, not to tell the member to go
 * find it.
 */
export function isActiveSessionConflict(error: unknown): boolean {
  return statusOf(error) === 409;
}

/**
 * Copy for a failed start.
 *
 * The 403 branch is the alumni rule (`study-sessions.md` § Edge Cases): alumni
 * cannot record study hours, and the server says so in a sentence worth
 * relaying verbatim. It is also reachable as a plain permission denial, which
 * is why the server's own message wins when there is one.
 */
export function startErrorCopy(error: unknown): string {
  const status = statusOf(error);
  const serverMessage = serverMessageOf(error);

  // The subscription gate, above the generic 403 arm because both arrive as
  // 403 and the arm below relays the server's own words — which for an
  // `incomplete` chapter are "…complete checkout to use this feature.", a
  // purchase instruction the store declaration forbids in this app (#2297).
  // Keyed on the message, not `codeOf`, which is `null` on every real
  // response (#1020).
  if (subscriptionRefusalOf(error)) return SUBSCRIPTION_REFUSAL_COPY.study;

  // The module gate, above the 403 arm for the same reason. Matched on the
  // message too: this branch used `codeOf` until #2393 and never fired.
  if (moduleRefusalOf(error)) return MODULE_OFF_COPY.start;

  switch (status) {
    case 400:
      // "Location is outside the geofence" / "Geofence is not active" — both
      // are specific and both name the fix implicitly.
      return serverMessage ?? "You need to be inside the study zone to start.";
    case 403:
      return serverMessage ?? "You don't have access to study sessions here.";
    case 404:
      return "That study zone is no longer available. Pick another one.";
    case 409:
      return (
        serverMessage ?? "You already have a study session running."
      );
    default:
      return (
        serverMessage ??
        "Couldn't start your session. Check your connection and try again."
      );
  }
}

/**
 * Copy for a failed pause, resume, heartbeat or stop.
 *
 * 404 is its own case and the important one: "No active study session found"
 * means the server has already closed the session this screen is holding — the
 * member has lost nothing they earned, and saying so is the difference between
 * a shrug and a support message.
 */
export function sessionErrorCopy(error: unknown): string {
  const status = statusOf(error);
  const serverMessage = serverMessageOf(error);

  // The subscription gate, above the generic 403 arm because both arrive as
  // 403 and the arm below relays the server's own words — which for an
  // `incomplete` chapter are "…complete checkout to use this feature.", a
  // purchase instruction the store declaration forbids in this app (#2297).
  // Keyed on the message, not `codeOf`, which is `null` on every real
  // response (#1020).
  //
  // `studySession`, not `study`: every non-404 failure here leaves the session
  // ACTIVE server-side and `endSession` deliberately keeps the End button so
  // the member can retry once billing is sorted. Saying "study sessions can't
  // be recorded" would tell them their banked time was lost, and a member who
  // walks away on that gets the session expired for zero.
  if (subscriptionRefusalOf(error)) {
    return SUBSCRIPTION_REFUSAL_COPY.studySession;
  }

  // The module gate, likewise above the 403 arm (see `MODULE_OFF_COPY`).
  if (moduleRefusalOf(error)) return MODULE_OFF_COPY.session;

  switch (status) {
    case 404:
      return "That session has already been closed. Your credited time is safe.";
    case 400:
      return serverMessage ?? "Couldn't update your session.";
    case 403:
      return serverMessage ?? "You don't have access to study sessions here.";
    default:
      return (
        serverMessage ??
        "Couldn't reach the chapter. Your session keeps its server-side time."
      );
  }
}
