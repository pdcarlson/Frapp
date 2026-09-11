/**
 * Fail-closed Stripe Price / account consistency.
 *
 * `validateEnv` only requires a non-empty `STRIPE_PRICE_ID`. A `price_...` from
 * another Stripe account (old org, or the Signet sandbox that holds customers
 * and zero Prices) therefore boots, then checkout 503s at runtime — FRAPP-API-4.
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
  constructor(priceId: string, reason: string) {
    super(
      `${STRIPE_PRICE_ACCOUNT_MISMATCH_MESSAGE} (${reason}; STRIPE_PRICE_ID=${priceId})`,
    );
    this.name = 'StripePriceAccountMismatchError';
  }
}

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
  field: 'code' | 'type' | 'name',
): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Misconfiguration, not a Stripe blip: wrong/missing Price, inactive Price's
 * retrieve still succeeds — callers handle `active` separately — or a secret
 * that Stripe will not authenticate.
 */
export function isStripePriceMisconfigurationError(error: unknown): boolean {
  const code = stripeErrorField(error, 'code');
  if (code === 'resource_missing') return true;
  const type = stripeErrorField(error, 'type');
  return type === 'authentication_error' || type === 'invalid_request_error';
}
