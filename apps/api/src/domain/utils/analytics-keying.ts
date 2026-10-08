import { createHmac } from 'node:crypto';

/**
 * Pseudonymous keying for analytics and observability.
 *
 * Server-side only. The raw `user_id` must never reach the analytics provider:
 * events are keyed by `hmac_sha256(salt, user_id)`, and the salt is an API
 * secret. Web and mobile neither hold the salt nor derive a key. They fetch
 * already-hashed hex from `GET /v1/analytics/identity`
 * (`spec/behavior/observability.md` § Correlation schema). See
 * `spec/behavior/data-retention.md` (#analytics-events-pseudonymous).
 *
 * Moved out of `@repo/validation` (#3268), where it was a pure-TypeScript
 * SHA-256 so a client could have produced the same bytes. No client ever did,
 * so it uses `node:crypto` now. `analytics-keying.spec.ts` pins the RFC 4231
 * vectors and the digests the old implementation produced, so every stored
 * pseudonym stays the same.
 */

/**
 * HMAC-SHA-256 of `message` under `key`, returned as a lowercase hex string.
 * Both inputs are UTF-8 encoded. Exported for the specs; callers should prefer
 * {@link hashUserIdForAnalytics}.
 */
export function hmacSha256Hex(key: string, message: string): string {
  return createHmac('sha256', Buffer.from(key, 'utf8'))
    .update(Buffer.from(message, 'utf8'))
    .digest('hex');
}

/**
 * Derive the pseudonymous analytics key for a user.
 *
 * `salt` is the per-environment secret held in the same secret store as other
 * credentials (never in the analytics provider's environment), and `userId` is
 * the raw Frapp user id. The returned hex digest is the only user identifier
 * that may be sent to the analytics provider.
 *
 * @throws if `salt` or `userId` is empty — a missing salt must fail loudly
 *   rather than silently keying every user under the empty-string salt.
 */
export function hashUserIdForAnalytics(salt: string, userId: string): string {
  if (!salt) {
    throw new Error('Analytics salt is required to key a user pseudonymously');
  }
  if (!userId) {
    throw new Error('userId is required to derive an analytics key');
  }
  return hmacSha256Hex(salt, userId);
}

/**
 * Derive the pseudonymous analytics key for a *chapter*.
 *
 * Funnel events are grouped by chapter (a chapter, not a user, is what
 * activates), so the provider needs a stable per-chapter key — but a raw
 * `chapter_id` is an identifier, and `spec/behavior/observability.md` already
 * fixes the rule for identifiers crossing an external boundary: *"`user_id` and
 * `chapter_id` are sent as HMAC-SHA256 hashes using the same per-environment
 * salt as the analytics pipeline."* This is that hash.
 *
 * Same salt and same construction as {@link hashUserIdForAnalytics} on purpose:
 * a chapter hashed here and the same chapter hashed at the error-reporting
 * boundary produce the same digest, so an operator can correlate a chapter
 * across providers without either one ever holding the raw id. User ids and
 * chapter ids are UUIDs drawn from disjoint tables, so sharing the salt cannot
 * collide one namespace onto the other.
 *
 * @throws if `salt` or `chapterId` is empty — same reasoning as the user hash.
 */
export function hashChapterIdForAnalytics(
  salt: string,
  chapterId: string,
): string {
  if (!salt) {
    throw new Error(
      'Analytics salt is required to key a chapter pseudonymously',
    );
  }
  if (!chapterId) {
    throw new Error('chapterId is required to derive an analytics key');
  }
  return hmacSha256Hex(salt, chapterId);
}

/**
 * Derive the pseudonymous observability key for a **request origin** (IP).
 *
 * `spec/behavior/observability.md` § Structured Logging is unconditional: IPs
 * are *never* logged. But a security event ("this origin has failed auth 20
 * times in 5 minutes") is worthless without a stable per-origin key, so the two
 * requirements only look like they conflict. What a spike rule needs is
 * *grouping*, not the address — and an HMAC gives grouping while leaving no
 * address anywhere in the logs.
 *
 * Same salt and construction as {@link hashUserIdForAnalytics}, for the same
 * reason given there: one operator-visible pseudonym per real-world entity,
 * correlatable across the log and error-reporting boundaries without either
 * side holding the raw value.
 *
 * Unlike the user and chapter hashes this one is **not** reversible even with
 * the salt in hand — a 32-bit IPv4 space is small enough to enumerate against a
 * known salt. That is a property to be aware of when handling the salt, not a
 * reason to skip the hash: an attacker who holds the salt has already lost you
 * the user and chapter pseudonyms too.
 *
 * @throws if `salt` or `ip` is empty — a missing salt must fail loudly rather
 *   than silently keying every origin under the empty-string salt. Callers that
 *   cannot guarantee a salt should omit the field entirely instead of passing
 *   `''` (see the API's security-event builder, which does exactly that).
 */
export function hashIpForObservability(salt: string, ip: string): string {
  if (!salt) {
    throw new Error(
      'Observability salt is required to key a request origin pseudonymously',
    );
  }
  if (!ip) {
    throw new Error('ip is required to derive an observability key');
  }
  return hmacSha256Hex(salt, ip);
}
