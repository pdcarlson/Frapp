import type { AuthGateDestination } from "@/lib/auth-gate";

/**
 * An invite link opened in the app by a member who already has a chapter
 * (#4002, #4341).
 *
 * Since the app claims `app.frapp.live/join` (universal links and App Links),
 * every invite link a member taps opens here. s02 is the zero-membership
 * screen and the gate keeps a member with a chapter off it, so their invite
 * goes to the second-chapter card instead (`app/(auth)/join-another.tsx`),
 * where they join with the session they have. Until #4341 it went to web
 * `/join` in an in-app browser, which had no app session, so the member
 * signed in a second time.
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
