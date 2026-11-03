/**
 * Analytics payload hygiene, shared by the API's `POST /v1/analytics/events`
 * gate and the clients that build events (`assertContentFreeProperties`,
 * `AnalyticsEvent`).
 *
 * The pseudonymous keying (`hmac_sha256(salt, user_id)`) and the activation
 * funnel live in the API, which alone holds the salt and records milestones
 * (`apps/api/src/domain/utils/analytics-keying.ts`,
 * `apps/api/src/domain/constants/activation-milestones.ts`, #3268). Web and
 * mobile fetch already-hashed hex from `GET /v1/analytics/identity`
 * (`spec/behavior/observability.md` § Correlation schema). See
 * `spec/behavior/data-retention.md` (#analytics-events-pseudonymous).
 */

// ── Payload hygiene ──────────────────────────────────────────────────────────

/**
 * Property keys that must never appear on an analytics event because they carry
 * content or PII rather than behavior. The check is conservative and
 * case-insensitive; it is the SDK-boundary backstop behind code review, not a
 * substitute for authors choosing behavioral properties.
 */
export const FORBIDDEN_ANALYTICS_PROPERTY_KEYS = [
  'content',
  'body',
  'message',
  'text',
  'transcript',
  'email',
  'name',
  'displayname',
  'phone',
  'address',
  'password',
  'token',
  'document',
  'attachment',
] as const;

/** Normalize a property key for comparison: lowercase, strip spaces/_/-. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]/g, '');
}

const FORBIDDEN_KEY_SET = new Set<string>(
  FORBIDDEN_ANALYTICS_PROPERTY_KEYS.map(normalizeKey),
);

export type AnalyticsProperties = Record<
  string,
  string | number | boolean | null
>;

export interface AnalyticsEvent {
  /** Behavioral event name, e.g. "opened-channel", "ran-slash-command". */
  name: string;
  /** Pseudonymous user key, `hashUserIdForAnalytics` in the API. */
  distinctId: string;
  /** Behavioral, content-free properties. */
  properties?: AnalyticsProperties;
}

/**
 * Thrown when an analytics event carries content/PII. A distinct type so the
 * API boundary can map it to a 400 (caller error) while letting genuine server
 * faults surface as 500 instead of being masked.
 */
export class ContentFreePropertyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentFreePropertyError';
  }
}

/**
 * Throw if an event's properties look like content/PII. Rejects both forbidden
 * keys (email, body, …) and non-scalar values — a nested object or array could
 * smuggle content past the key check (e.g. `{ meta: { body: "…" } }`). Returns
 * the event unchanged on success so it can be used inline at the SDK boundary.
 */
export function assertContentFreeProperties(
  event: AnalyticsEvent,
): AnalyticsEvent {
  const properties = event.properties ?? {};

  const forbiddenKeys = Object.keys(properties).filter((key) =>
    FORBIDDEN_KEY_SET.has(normalizeKey(key)),
  );
  if (forbiddenKeys.length > 0) {
    throw new ContentFreePropertyError(
      `Analytics event "${event.name}" carries forbidden content/PII propert${
        forbiddenKeys.length === 1 ? 'y' : 'ies'
      }: ${forbiddenKeys.join(', ')}. Event properties must describe behavior, not content.`,
    );
  }

  const nonScalarKeys = Object.entries(properties)
    .filter(([, value]) => value !== null && typeof value === 'object')
    .map(([key]) => key);
  if (nonScalarKeys.length > 0) {
    throw new ContentFreePropertyError(
      `Analytics event "${event.name}" has non-scalar propert${
        nonScalarKeys.length === 1 ? 'y' : 'ies'
      }: ${nonScalarKeys.join(', ')}. Properties must be a string, number, boolean, or null — nested objects/arrays can smuggle content.`,
    );
  }

  return event;
}
