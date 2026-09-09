/**
 * Correlation identifiers. These are distinct spaces — do not copy one
 * into another. The product table lives in `spec/behavior/observability.md`
 * § Correlation schema (`spec/behavior/observability.md`, ADR-22).
 */

/** HTTP header that carries the request-correlation id. */
export const REQUEST_ID_HEADER = "x-request-id";

/** Sentry/OTEL outgoing + incoming trace header. Not `x-request-id`. */
export const SENTRY_TRACE_HEADER = "sentry-trace";

/** W3C/Sentry baggage header. Travels beside `x-request-id`; never becomes it. */
export const BAGGAGE_HEADER = "baggage";

/**
 * HMAC-SHA256 hex digest: 64 lowercase hex characters.
 *
 * This is the shape of `hmac_sha256(salt, id)` and nothing else the
 * codebase produces. Clients never compute it; they receive it from
 * `GET /v1/analytics/identity`. The salt is API-only.
 */
export const PSEUDONYM_HEX_RE = /^[0-9a-f]{64}$/;

export function isPseudonymHex(value: unknown): value is string {
  return typeof value === "string" && PSEUDONYM_HEX_RE.test(value);
}

/** Request-correlation id (`req_<uuid>` or an inbound honor). Not a trace id. */
export type RequestId = string;

/** Sentry / OpenTelemetry trace id. Not `x-request-id`. */
export type SentryTraceId = string;

/** Sentry error event id. Optional PostHog timeline marker, never a user id. */
export type SentryEventId = string;

/** PostHog `distinct_id`: `hmac_sha256(salt, user_id)`. */
export type PostHogDistinctId = string;

/** PostHog chapter group: `hmac_sha256(salt, chapter_id)`. */
export type PostHogChapterGroupId = string;

/**
 * Client-visible analytics identity.
 *
 * HMAC stays API-local (Node crypto + the salt). This package only names the
 * shape so web/mobile/landing cannot invent a second one.
 *
 * `chapter_group_id` is the intended field when a chapter is in context.
 * Today's API DTO is `{ distinct_id, enabled }` only — that gap is current
 * behavior (#2042), not a reason to omit the field from the type.
 */
export interface AnalyticsIdentity {
  distinct_id: PostHogDistinctId;
  enabled: boolean;
  chapter_group_id?: PostHogChapterGroupId;
}
