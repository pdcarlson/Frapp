import { serverMessageOf, statusOf } from "@repo/api-sdk";

/**
 * Copy for a failed invite redemption.
 *
 * `apps/web/app/join/page.tsx` had no status branching at all before the #920
 * Profile & pre-auth slice: every failure rendered
 * `getErrorMessage(error, "Something went wrong. Please try again.")` in a
 * toast — the fallback string `writing.md` §1 bans by name, on a screen whose
 * two most likely failures need **opposite** next actions.
 *
 * Status is the reliable split, and `spec/behavior/onboarding.md` §Invite Token
 * Rules fixes both codes: a token that is missing, used or past its 24 hours is
 * **410 Gone**, and a user who already belongs to that chapter is **409
 * Conflict**. `AllExceptionsFilter` puts `statusCode` on every error body and
 * `useRedeemInvite` rethrows that body unchanged, so `statusOf` reads it
 * directly — no new error-code framework, and no client-side re-derivation of
 * a rule the server already owns.
 *
 * **The strings are shared with `apps/mobile/lib/onboarding/join-errors.ts`
 * verbatim**, and `spec/ui/design-system/writing.md` §7's "Join chapter" table
 * is the single place they are written down. Two surfaces redeeming the same
 * token must not explain the same 410 differently; that table is what stops
 * them forking, since neither app can import the other's module and
 * `packages/` is not the home for four strings.
 *
 * **This is error copy, not a status vocabulary.** It deliberately exports no
 * `*Kind` mapper and does not join `components/shared/status-kind.test.ts`'s
 * `MAPPERS`: nothing here is persisted, badged or coloured, so there is no
 * badge kind to be wrong about. Recorded so the absence reads as a decision —
 * the same call `settings-status.ts` argues for a module tier.
 */
export function joinErrorCopy(error: unknown): string {
  const status = statusOf(error);
  if (status === 410) {
    return "This invite has expired or already been used. Ask an officer for a new one.";
  }
  if (status === 409) {
    return "You're already a member of this chapter. Open it from your chapter list.";
  }
  return (
    serverMessageOf(error) ??
    "Couldn't join that chapter. Check the invite and try again."
  );
}

/**
 * The chapter the redemption joined, or `null`.
 *
 * Mirrors `redeemChapterId` in the mobile module. The response is typed loosely
 * at the hook boundary, and the caller must not persist an active chapter it
 * cannot name — an empty string would select a chapter that does not exist.
 */
export function redeemChapterId(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  if (!("chapterId" in result)) return null;
  const chapterId = (result as { chapterId?: unknown }).chapterId;
  return typeof chapterId === "string" && chapterId.length > 0
    ? chapterId
    : null;
}
