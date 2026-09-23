import { serverMessageOf, statusOf } from "@repo/api-sdk";
import {
  ACCOUNT_DELETED_MESSAGE,
  JOIN_TERMS_REQUIRED_COPY,
  TERMS_PROMPT_COPY,
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
 * Two refusals are told apart by their message, since no error `code` reaches
 * a client (#1020): the Terms refusal (a 403, `isTermsRequiredError`), which
 * wants the checkbox, and a deleted account whose session hasn't ended (a
 * 410 like an expired invite, but no new invite would help).
 *
 * **This is error copy, not a status vocabulary.** Nothing here is persisted,
 * badged or coloured, so there is no badge kind to map.
 */
export function joinErrorCopy(error: unknown): string {
  if (isTermsRequiredError(error)) return JOIN_TERMS_REQUIRED_COPY;
  const status = statusOf(error);
  if (status === 410 && serverMessageOf(error) === ACCOUNT_DELETED_MESSAGE) {
    return TERMS_PROMPT_COPY.deleted;
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
