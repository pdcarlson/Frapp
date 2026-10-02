/**
 * Fail-closed Stripe Price / account consistency.
 *
 * `validateEnv` only requires a non-empty `STRIPE_PRICE_ID`. A `price_...` from
 * another Stripe account (an old org, or a separate sandbox, which can hold
 * customers and zero Prices) therefore boots, then checkout 503s at runtime —
 * FRAPP-API-4.
 * Retrieving the configured Price with `STRIPE_SECRET_KEY` is the gate mocked
 * billing tests cannot provide. Canonical footgun:
 * `docs/internal/environment/ENV_REFERENCE.md` § Core App Secrets.
 *
 * Skip only the placeholder secrets this repo already uses when it does not
 * talk to Stripe (CI image boot, E2E, OpenAPI export, cloud sandbox, unit
 * fixtures). A real-looking `sk_test_` / `sk_live_` is validated even in
 * development.
 */

export const STRIPE_PRICE_ACCOUNT_MISMATCH_MESSAGE =
  "STRIPE_SECRET_KEY's Stripe account and STRIPE_PRICE_ID must match — see ENV_REFERENCE.md § Core App Secrets";

/**
 * Exact secrets the repo plants so Nest can boot without Stripe. Keep in lockstep
 * with `apps/api/test/setup-e2e.ts`, `.github/workflows/ci.yml` (docker /health),
 * `scripts/cloud-sandbox-up.sh`, `scripts/check-api-contract-drift.mjs`, and
 * `stripe.service.spec.ts`.
 */
const PLACEHOLDER_STRIPE_SECRETS = new Set([
  'sk_test_dummy',
  'sk_test_ci_not_real',
  'sk_test_placeholder_cloud_sandbox',
  'placeholder_value',
  'test_secret_key',
]);

const PLACEHOLDER_SECRET_MARKERS = [
  'dummy',
  'placeholder',
  'not_real',
] as const;

export class StripePriceAccountMismatchError extends Error {
  /**
   * Which misconfiguration this is, when no Stripe error says so (`cause`).
   *
   * The readiness 503 reports this error as its cause, and every variant is
   * thrown from one method, so Sentry's grouping sees the same class over the
   * same frames. `errorFingerprint` keys on `code` and on the Stripe error in
   * `cause` to keep a missing Price, a revoked key and an inactive Price apart
   * (#2131). The message already names the fault for a human.
   */
  readonly code?: string;

  constructor(
    priceId: string,
    reason: string,
    options: { cause?: unknown; code?: string } = {},
  ) {
    super(
      `${STRIPE_PRICE_ACCOUNT_MISMATCH_MESSAGE} (${reason}; STRIPE_PRICE_ID=${priceId})`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'StripePriceAccountMismatchError';
    if (options.code !== undefined) this.code = options.code;
  }

  /**
   * A fixed, non-secret name for the fault, safe for a public response body
   * (`/health/ready`, #2999): this error's own `code`, else the Stripe error
   * code or API type in `cause` (`resource_missing`, `api_key_expired`,
   * `authentication_error`), else `misconfigured`. Those tell an operator
   * whether to fix the Price id or rotate the key. The message is never
   * public: it holds the configured Price id and Stripe's raw text, which for
   * a revoked key names its type and last four characters.
   */
  get category(): string {
    if (this.code !== undefined) return this.code;
    for (const field of ['code', 'rawType', 'type'] as const) {
      const value = stripeErrorField(this.cause, field);
      if (value && STRIPE_CATEGORY_SHAPE.test(value)) return value;
    }
    return 'misconfigured';
  }
}

/**
 * Stripe's error codes and API types are lowercase snake_case enums. Anything
 * else (a class name, free text from a shim) falls through to `misconfigured`
 * rather than reaching a public body.
 */
const STRIPE_CATEGORY_SHAPE = /^[a-z][a-z_]{0,63}$/;

export function shouldSkipStripePriceConsistency(
  secret: string | undefined | null,
): boolean {
  if (typeof secret !== 'string') return true;
  const trimmed = secret.trim();
  if (!trimmed) return true;
  if (PLACEHOLDER_STRIPE_SECRETS.has(trimmed)) return true;

  const lower = trimmed.toLowerCase();
  if (PLACEHOLDER_SECRET_MARKERS.some((marker) => lower.includes(marker))) {
    return true;
  }

  return !/^sk_(test|live)_/.test(trimmed);
}

function stripeErrorField(
  error: unknown,
  field: 'code' | 'type' | 'rawType' | 'name',
): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Misconfiguration, not a Stripe blip: wrong/missing Price, inactive Price's
 * retrieve still succeeds — callers handle `active` separately — or a secret
 * that Stripe will not authenticate.
 *
 * Reads `rawType` as well as `type`. stripe-node's `StripeError` constructor
 * does `this.type = type || this.constructor.name` and keeps the API's own
 * value on `rawType`, so a real 401 arrives as `type: 'StripeAuthenticationError'`
 * and the `authentication_error` comparison below never matched. Rotating
 * `STRIPE_SECRET_KEY` in Stripe without updating Infisical was therefore
 * classified transient by both boot guards: "not refusing boot", deploy green,
 * every Stripe call 401ing at runtime — the failure this predicate exists to
 * make loud. Both spellings are checked because `rawType` is stripe-node's and
 * a hand-built error object in a test or a fetch shim may only set `type`.
 */
const MISCONFIGURATION_ERROR_TYPES = new Set([
  'authentication_error',
  'invalid_request_error',
  // Class names, for the same errors as stripe-node actually constructs them.
  'StripeAuthenticationError',
  'StripePermissionError',
  'StripeInvalidRequestError',
]);

export function isStripePriceMisconfigurationError(error: unknown): boolean {
  const code = stripeErrorField(error, 'code');
  if (code === 'resource_missing') return true;
  for (const field of ['rawType', 'type'] as const) {
    const value = stripeErrorField(error, field);
    if (value && MISCONFIGURATION_ERROR_TYPES.has(value)) return true;
  }
  return false;
}
