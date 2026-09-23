import { codeOf, serverMessageOf, statusOf } from "@repo/api-sdk";
import { LEGAL_ACCEPTANCE_REQUIRED_CODE } from "@repo/validation";

/** The copy for a join the server refused for want of the Terms checkbox. */
export const JOIN_TERMS_REQUIRED_COPY =
  "Agree to the Terms of Service and Privacy Policy to join.";

/**
 * True when the server refused a join because the caller hasn't accepted the
 * current Terms and didn't send the checkbox (#2302). The join screen then
 * shows the checkbox even if its own status read said it wasn't needed.
 */
export function isTermsRequiredError(error: unknown): boolean {
  return codeOf(error) === LEGAL_ACCEPTANCE_REQUIRED_CODE;
}

/**
 * Copy for a failed invite redemption. Status is the reliable split: 410 is
 * expired/used/missing, 409 is already a member, a 403 carrying
 * `legal.acceptance_required` wants the Terms checkbox, and everything else is
 * retryable.
 */
export function joinErrorCopy(error: unknown): string {
  if (isTermsRequiredError(error)) return JOIN_TERMS_REQUIRED_COPY;
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

export function redeemChapterId(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  if (!("chapterId" in result)) return null;
  const chapterId = (result as { chapterId?: unknown }).chapterId;
  return typeof chapterId === "string" && chapterId.length > 0
    ? chapterId
    : null;
}
