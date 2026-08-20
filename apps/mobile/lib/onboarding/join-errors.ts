import { serverMessageOf, statusOf } from "@/lib/api-error";

/**
 * Copy for a failed invite redemption. Status is the reliable split: 410 is
 * expired/used/missing, 409 is already a member, everything else is retryable.
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

export function redeemChapterId(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  if (!("chapterId" in result)) return null;
  const chapterId = (result as { chapterId?: unknown }).chapterId;
  return typeof chapterId === "string" && chapterId.length > 0
    ? chapterId
    : null;
}
