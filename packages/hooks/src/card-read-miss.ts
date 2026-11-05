import { codeOf, statusOf } from "@repo/api-sdk";

/**
 * Whether a chat card's read of its live record was answered rather than
 * failed, so the read hook resolves it to `null`: a 404 (the record is gone),
 * or a 403 from the route's own checks (a permission the viewer lacks, or a
 * module that is off). The card then drops its live line instead of keeping
 * the last read, and an expected miss is neither retried nor reported.
 * `useRushCandidate` and `useServiceEntry` read through it.
 *
 * `ChapterGuard`'s `chapter.context.*` 403s are not answers. They mean the
 * request's chapter and the session's disagree, which clears once the token
 * catches up with a chapter switch, so they throw and keep the query's retry
 * and its error line. The guard's two uncoded 403s (no user profile, no such
 * chapter) don't clear by themselves and read as a miss.
 */
export function isCardReadMiss(error: unknown): boolean {
  const status = statusOf(error);
  if (status === 404) return true;
  if (status !== 403) return false;
  return !codeOf(error)?.startsWith("chapter.context.");
}
