import { codeOf, statusOf } from "@repo/api-sdk";

/** `ChapterGuard`'s 403 when the `x-chapter-id` header and the token's claim disagree. */
const CHAPTER_CONTEXT_MISMATCH = "chapter.context.mismatch";

/**
 * Whether a chat card's read of its live record was answered rather than
 * failed, so the read hook resolves it to `null`: a 404 (the record is gone),
 * or a 403 that won't change on a retry (a permission the viewer lacks, a
 * module that is off, or `ChapterGuard`'s `chapter.context.invalid` for a
 * viewer no longer in the chapter). The card then drops its live line instead
 * of keeping the last read, and an expected miss is neither retried nor
 * reported. `useRushCandidate` and `useServiceEntry` read through it.
 *
 * The one 403 that is not an answer is `chapter.context.mismatch`: the
 * request's chapter and the session token's disagree, which clears once the
 * token catches up with a chapter switch. It throws, and keeps the query's
 * retry and its error line.
 */
export function isCardReadMiss(error: unknown): boolean {
  const status = statusOf(error);
  if (status === 404) return true;
  if (status !== 403) return false;
  return codeOf(error) !== CHAPTER_CONTEXT_MISMATCH;
}
