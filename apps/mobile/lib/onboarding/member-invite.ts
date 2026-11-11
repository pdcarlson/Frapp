import { extractInviteTokenFromQuery } from "@repo/validation";
import { webJoinUrl } from "@/lib/onboarding/chapter-wizard/invite-link";

/**
 * An invite link opened in the app by a member who already has a chapter
 * (#4002).
 *
 * Since the app claims `app.frapp.live/join` (universal links and App Links),
 * every invite link a member taps opens here. s02 is the zero-membership
 * screen: it has no way back to a chapter, and the `(auth)` layout sends a
 * member with one to their tabs. Before the app claimed the links, the same
 * tap opened web `/join`, where joining a second chapter works. So the app
 * hands such an invite to the web in an in-app browser and stays on the
 * member's chapter. `web=1` is web `/join`'s "continue in the browser" mark
 * (`apps/web/lib/auth/join-visit.ts`), so the page shows its join form
 * rather than offering this app again. Joining a second chapter inside the
 * app is its own piece of work.
 */

type RouteParams = Record<string, string | string[] | undefined>;

/** The invite a `/join` route's params carry (`token`, `invite`, `code`). */
export function inviteFromRouteParams(params: RouteParams): string | null {
  return extractInviteTokenFromQuery((key) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  });
}

/** The web `/join` page for `token`, marked as chosen in the browser. */
export function memberInviteWebUrl(token: string, origin?: string): string {
  return `${webJoinUrl(token, origin)}&web=1`;
}
