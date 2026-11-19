import * as Crypto from "expo-crypto";

/**
 * The invite card's visit id on the phone (#5663): one random UUID per
 * invite, kept in memory for as long as the app runs, so a native Apple or
 * Google sign-in, or the email code, comes back to the same visit and the
 * join lands in the same funnel as the card view (`useInviteFunnel` in
 * `@repo/hooks`). A relaunch starts a new visit, which only splits one visit
 * in two: it names no one and is analytics only. Web keeps its own
 * (`apps/web/lib/auth/join-visit.ts` `inviteVisitId`).
 */
let kept: { token: string; id: string } | null = null;

export function inviteVisitId(
  token: string,
  mint: () => string = () => Crypto.randomUUID(),
): string | null {
  if (kept?.token === token) return kept.id;
  try {
    kept = { token, id: mint() };
  } catch {
    // The native module isn't there (a test, or a broken build): no visit.
    return null;
  }
  return kept.id;
}

/** @internal Tests only: forget the kept visit. */
export function resetInviteVisitForTests(): void {
  kept = null;
}
