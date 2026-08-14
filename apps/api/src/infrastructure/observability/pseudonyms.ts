import {
  hashChapterIdForAnalytics,
  hashIpForObservability,
  hashUserIdForAnalytics,
} from '@repo/validation';

/**
 * The one place the API reads the observability salt.
 *
 * `spec/behavior/observability.md` fixes two rules that both need a salt:
 * identifiers crossing an *external* boundary (Sentry) are HMAC-hashed, and IPs
 * are never written to internal logs in the clear either. Both use the same
 * per-environment `ANALYTICS_HMAC_SALT` as the analytics pipeline, so a chapter
 * hashed in a funnel event, in a security log line, and on a Sentry event all
 * produce the same digest — that shared digest is the only way an operator can
 * follow one tenant across the three surfaces without any of them holding a raw
 * id.
 *
 * Read from `process.env` rather than `ConfigService` because the first caller
 * is `initializeSentry()`, which runs *before* the Nest container exists. The
 * value is read per call rather than cached at module load so tests can set it
 * without module-registry surgery; it is a property lookup on a hot-ish path
 * only in the sense that errors are hot, which they should not be.
 */
function salt(): string {
  return process.env.ANALYTICS_HMAC_SALT ?? '';
}

/**
 * True when pseudonymization is possible at all.
 *
 * Everything below **fails closed** on a missing salt: it returns `undefined`
 * rather than the raw value. An unconfigured environment therefore loses the
 * ability to group events by user/chapter/origin — it never silently
 * downgrades to shipping raw identifiers to a third party, which is the one
 * outcome the spec forbids outright.
 */
export function pseudonymsAvailable(): boolean {
  return salt().length > 0;
}

/** Pseudonymous user key, or `undefined` when unavailable. Never the raw id. */
export function pseudonymizeUserId(userId: unknown): string | undefined {
  const s = salt();
  if (!s || typeof userId !== 'string' || !userId) return undefined;
  return hashUserIdForAnalytics(s, userId);
}

/** Pseudonymous chapter key, or `undefined` when unavailable. */
export function pseudonymizeChapterId(chapterId: unknown): string | undefined {
  const s = salt();
  if (!s || typeof chapterId !== 'string' || !chapterId) return undefined;
  return hashChapterIdForAnalytics(s, chapterId);
}

/** Pseudonymous request-origin key, or `undefined` when unavailable. */
export function pseudonymizeIp(ip: unknown): string | undefined {
  const s = salt();
  if (!s || typeof ip !== 'string' || !ip) return undefined;
  return hashIpForObservability(s, ip);
}
