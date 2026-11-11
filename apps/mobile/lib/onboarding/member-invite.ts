import type { AuthGateDestination } from "@/lib/auth-gate";
import { webJoinUrl } from "@/lib/onboarding/chapter-wizard/invite-link";

/**
 * An invite link opened in the app by a member who already has a chapter
 * (#4002).
 *
 * Since the app claims `app.frapp.live/join` (universal links and App Links),
 * every invite link a member taps opens here, not on the web. s02 is the
 * zero-membership screen: it has no way back to a chapter, and the gate keeps
 * a member with one on their tabs, the Terms prompt or s03. Before the app
 * claimed the links, the same tap opened web `/join`, where joining a second
 * chapter works. So the app hands such an invite to web `/join` in an in-app
 * browser and the member stays where the gate put them. `web=1` is web
 * `/join`'s "continue in the browser" mark (`apps/web/lib/auth/join-visit.ts`),
 * so the page shows its form rather than offering this app again.
 *
 * The cost: the in-app browser has no app session, so the member signs in
 * there (on iOS always; on Android only if Chrome isn't signed in to Frapp).
 * Joining a second chapter inside the app is its own piece of work.
 */

/** Gate destinations that mean "this account has a chapter". */
const MEMBER_DESTINATIONS: ReadonlySet<AuthGateDestination> = new Set([
  "tabs",
  "terms",
  "welcome",
]);

/**
 * Whether an invite arriving now belongs to the member path. The chapter
 * count is the read's own answer, not the gate's: the gate also says `tabs`
 * when the chapters read failed with nothing cached, and that account may
 * have no chapter at all, in which case s02 must keep the invite.
 */
export function isMemberInviteMoment(
  destination: AuthGateDestination,
  chapterCount: number | null,
): boolean {
  return (
    MEMBER_DESTINATIONS.has(destination) &&
    chapterCount !== null &&
    chapterCount > 0
  );
}

/** The web `/join` page for `token`, marked as chosen in the browser. */
export function memberInviteWebUrl(token: string, origin?: string): string {
  return `${webJoinUrl(token, origin)}&web=1`;
}
