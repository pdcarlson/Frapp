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
export const JOIN_FROM_SIGN_IN = "sign-in";

/** The sign-in footer's destination: `/join`, marked as coming from sign-in. */
export const JOIN_FROM_SIGN_IN_PATH = `/join?from=${JOIN_FROM_SIGN_IN}`;

export function shouldSkipJoinForMember({
  from,
  hasInvite,
  membershipCount,
}: {
  from: string | null;
  hasInvite: boolean;
  membershipCount: number;
}): boolean {
  return from === JOIN_FROM_SIGN_IN && !hasInvite && membershipCount > 0;
}
