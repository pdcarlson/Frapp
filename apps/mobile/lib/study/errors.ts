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

import { codeOf, serverMessageOf, statusOf } from "@repo/api-sdk";

export { serverMessageOf, statusOf };

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

  // The module gate speaks to officers: "Re-enable it in Settings → Modules to
  // make changes." A member cannot do that and should not be told to. The
  // structured code is the reliable discriminator — `ChapterGuard.enforceModule`
  // throws `{ code: 'chapter.module.disabled' }`, and this branch has to sit
  // above the generic 403 because both arrive as 403.
  if (codeOf(error) === "chapter.module.disabled") {
    return "Your chapter isn't tracking study hours right now. An officer can turn the module back on.";
  }

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
