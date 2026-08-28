import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison for secrets and signatures.
 *
 * `timingSafeEqual` throws when the two buffers differ in length, so the length
 * check has to come first — and that check is itself a (deliberate) leak of one
 * bit: whether the lengths matched. That is acceptable for the callers here,
 * whose expected values are fixed-width digests, where a length mismatch already
 * means "not a valid signature" rather than "wrong by this much".
 *
 * Shared by `custom-throttler.guard.ts` (JWT signature verification for
 * per-user rate-limit keying) and `check-in-token.ts` (event check-in token
 * verification). Both are in `interface/` and `domain/` respectively, and outer
 * layers may import inner ones, so `domain/utils` is the right home for one copy
 * rather than two.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}
