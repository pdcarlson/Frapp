import { serverMessageOf, statusOf } from "@repo/api-sdk";
import {
  ACCOUNT_DELETED_MESSAGE,
  JOIN_TERMS_REQUIRED_COPY,
} from "@repo/validation";
import { isTermsRequiredError } from "./legal-acceptance";

/**
 * Copy for a failed invite redemption, shared by web `/join` and mobile s02 so
 * two surfaces redeeming the same token can't explain the same failure
 * differently. `spec/ui/design-system/writing.md` § 7, Join chapter, is where
 * the strings are specified.
 *
 * Status is the reliable split, and `spec/behavior/onboarding.md` § Invite
 * Token Rules fixes the codes: a token that is missing, used or past its 24
 * hours is **410 Gone**, and a user who already belongs to that chapter is
 * **409 Conflict**. `AllExceptionsFilter` puts `statusCode` on every error
 * body and `useRedeemInvite` rethrows that body unchanged, so `statusOf` reads
 * it directly.
 *
 * Two refusals share a status with something else and need more than it: the
 * Terms refusal (a 403, `isTermsRequiredError`, by its code or its message),
 * which wants the checkbox, and a deleted account whose session hasn't ended
 * (a 410 like an expired invite, but no new invite would help), which has no
 * code and is told apart by its message.
 *
 * **This is error copy, not a status vocabulary.** Nothing here is persisted,
 * badged or coloured, so there is no badge kind to map.
 */
export function joinErrorCopy(error: unknown): string {
  if (isTermsRequiredError(error)) return JOIN_TERMS_REQUIRED_COPY;
  const status = statusOf(error);
  if (status === 410 && serverMessageOf(error) === ACCOUNT_DELETED_MESSAGE) {
    // Names no control: web `/join` and mobile s02 both show their own
    // `Signed in as … · Sign out` line beside it.
    return "This account has been deleted, so it can't join a chapter.";
  }
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
 * The title of an invite offered to the signed-in account (#3776, #3782):
 * web `/join` and mobile s02 both draw it (`writing.md` § Join chapter).
 */
export function pendingInviteTitle(chapterName: string): string {
  return `You've been invited to ${chapterName}`;
}

/**
 * The line under an offered invite's title: the school, who sent it and the
 * role it grants, whichever are known, joined by ` · `.
 */
export function pendingInviteDetail(invite: {
  university?: string | null;
  invited_by?: string | null;
  role?: string | null;
}): string {
  return [
    invite.university,
    invite.invited_by ? `from ${invite.invited_by}` : null,
    invite.role,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Whether an invite read or redeem failed because the invite is dead: missing,
 * used, expired, or the account itself is deleted (all 410). Mobile's confirm
 * card uses it to stop offering Join for a link that can't work (#3352).
 */
export function isDeadInviteError(error: unknown): boolean {
  return statusOf(error) === 410;
}

/**
 * The chapter the redemption joined, or `null`.
 *
 * The response is typed loosely at the hook boundary, and the caller must not
 * persist an active chapter it cannot name: an empty string would select a
 * chapter that does not exist.
 */
export function redeemChapterId(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  if (!("chapterId" in result)) return null;
  const chapterId = (result as { chapterId?: unknown }).chapterId;
  return typeof chapterId === "string" && chapterId.length > 0
    ? chapterId
    : null;
}
