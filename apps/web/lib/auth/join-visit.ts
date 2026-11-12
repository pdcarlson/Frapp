/**
 * When `/join` steps aside for a member who is already in a chapter (#3850).
 *
 * Only one way onto the page means "take me to my chapter": the sign-in
 * footer's Join your chapter link, which marks its visit with
 * `from=sign-in`. A member who signs in that way, with no invite in hand,
 * goes straight to `/chat`.
 *
 * Every other entry keeps the page, because it is deliberate or would loop:
 * an invite link may be for a second chapter, the chapter switcher's Join
 * another chapter is exactly that, and `/no-access` sends a member with no
 * role here. Sending that member to `/chat` would return them to
 * `/no-access`.
 */
const JOIN_FROM_SIGN_IN = "sign-in";

/**
 * A phone visit to `/join` that chose Continue in the browser over the app
 * (#4002), marked in the URL as `web=1` so the choice survives what it starts:
 * the sign-in or sign-up round trip (whose `redirectTo` carries the query), an
 * OAuth or email-confirm return, Sign in as someone else, and a refresh.
 * Without it, the page would offer the app again right after the member
 * signed in on the web.
 */
export const JOIN_IN_BROWSER_KEY = "web";
export const JOIN_IN_BROWSER_VALUE = "1";

/** The sign-in footer's destination: `/join`, marked as coming from sign-in. */
export const JOIN_FROM_SIGN_IN_PATH = `/join?from=${JOIN_FROM_SIGN_IN}`;

/**
 * Whether this visit could skip the page at all: the footer's marked visit,
 * with no invite in the URL. The page waits on the reads below only for
 * such a visit, so the rule lives here and nowhere else.
 */
export function isJoinSkipCandidate({
  from,
  hasInvite,
}: {
  from: string | null;
  hasInvite: boolean;
}): boolean {
  return from === JOIN_FROM_SIGN_IN && !hasInvite;
}

/**
 * Whether a candidate visit goes to `/chat`, decided once on arrival. It
 * stays on the page when the account has no chapter, when an invite was
 * emailed to it (the footer asked "Have an invite?", so its offers are why
 * the member came), or when it has no access in its chapter (a member with
 * no role, whom `/chat` would send to `/no-access`).
 */
export function shouldSkipJoinForMember({
  from,
  hasInvite,
  membershipCount,
  offerCount,
  hasAccess,
}: {
  from: string | null;
  hasInvite: boolean;
  membershipCount: number;
  offerCount: number;
  hasAccess: boolean;
}): boolean {
  return (
    isJoinSkipCandidate({ from, hasInvite }) &&
    membershipCount > 0 &&
    offerCount === 0 &&
    hasAccess
  );
}
