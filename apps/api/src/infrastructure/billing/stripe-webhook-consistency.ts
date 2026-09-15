/**
 * Fail-closed Stripe webhook endpoint / account consistency.
 *
 * `validateEnv` requires `STRIPE_WEBHOOK_SECRET` to be non-empty and nothing
 * more, and `stripe.service.ts` only reads it. Nothing checks that it belongs
 * to the account `STRIPE_SECRET_KEY` authenticates as — so a secret copied
 * from another environment boots clean, the deploy goes green, and then every
 * delivery fails signature verification. No subscription activation, no
 * invoice update, and no error anywhere except Stripe's own dashboard.
 *
 * That is exactly what production ran on until 2026-09-15: a test-mode
 * `whsec_` pointed at the live API, while live mode had no endpoint at all.
 *
 * WHAT THIS CAN AND CANNOT CATCH. Stripe returns a signing secret once, at
 * creation, and offers no endpoint to verify one. So the secret VALUE is
 * unverifiable offline and this check does not pretend otherwise. What it does
 * verify is that the account holding `STRIPE_SECRET_KEY` has an enabled
 * endpoint pointing at this deployment's own `${API_URL}/v1/webhooks/stripe`.
 * That is what was false in the incident above — live mode had no endpoint —
 * and it is false for every cross-environment paste that also crosses an
 * account or a mode. It stays true, and silent, for a wrong `whsec_` copied
 * between two endpoints of the SAME account. Narrow the residual gap by not
 * keeping a second endpoint aimed at the same URL, rather than by trusting
 * this check to see it.
 *
 * Skipped wherever there is no registered endpoint to find: placeholder
 * secrets (CI image boot, E2E, OpenAPI export, cloud sandbox, unit fixtures)
 * and any `API_URL` that is missing, non-https, or loopback — a laptop with a
 * real `sk_test_` must still boot.
 */

export const STRIPE_WEBHOOK_ENDPOINT_MISSING_MESSAGE =
  "STRIPE_SECRET_KEY's Stripe account has no enabled webhook endpoint for this deployment — see ENV_REFERENCE.md § Core App Secrets";

/** Mirrors the path built by `webhook.controller.ts` under global URI versioning. */
export const STRIPE_WEBHOOK_PATH = '/v1/webhooks/stripe';

export class StripeWebhookEndpointMismatchError extends Error {
  constructor(expectedUrl: string, reason: string) {
    super(
      `${STRIPE_WEBHOOK_ENDPOINT_MISSING_MESSAGE} (${reason}; expected ${expectedUrl}). ` +
        'The signing secret itself cannot be verified from here, so a green boot ' +
        'is not proof that STRIPE_WEBHOOK_SECRET is the right one.',
    );
    this.name = 'StripeWebhookEndpointMismatchError';
  }
}

/**
 * The endpoint URL this deployment expects Stripe to call, derived from
 * `API_URL` rather than hardcoded, so staging checks staging.
 *
 * Returns `null` when there is nothing meaningful to check: unset, unparseable,
 * non-https, or a loopback/private host that Stripe could never reach.
 */
export function expectedWebhookUrl(
  apiUrl: string | undefined | null,
): string | null {
  if (typeof apiUrl !== 'string') return null;
  const trimmed = apiUrl.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  // `URL.hostname` KEEPS the brackets for IPv6 — `new URL('https://[::1]')`
  // gives `'[::1]'`, never `'::1'` — so comparing the bare form is dead code
  // and an IPv6-only box with a real sk_test_ would be refused boot.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const unreachable =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.startsWith('192.168.') ||
    host.startsWith('10.');
  if (unreachable) return null;

  return `${url.origin}${STRIPE_WEBHOOK_PATH}`;
}

/**
 * Compare origin + path only.
 *
 * Stripe's own API-version upgrade runbook tells you to register the
 * replacement endpoint with a disambiguating query parameter
 * (`…/webhooks?version=2024-04-10`) and disable the old one. Comparing whole
 * strings would call that correctly-configured endpoint a mismatch — and since
 * this guard can refuse boot, following Stripe's documented procedure would
 * take the entire API down. A trailing slash and host case are ignored for the
 * same reason: they are differences Stripe does not consider meaningful.
 */
function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
}

export interface StripeWebhookEndpointLike {
  url?: string | null;
  status?: string | null;
  enabled_events?: readonly string[] | null;
}

/** Every endpoint registered for `expectedUrl`, enabled or not. */
export function findEndpointsForUrl<T extends StripeWebhookEndpointLike>(
  endpoints: readonly T[],
  expectedUrl: string,
): T[] {
  const wanted = normalizeUrl(expectedUrl);
  return endpoints.filter(
    (endpoint) =>
      typeof endpoint.url === 'string' && normalizeUrl(endpoint.url) === wanted,
  );
}

/**
 * The enabled endpoint for `expectedUrl`, or `null`. A disabled endpoint is not
 * a match: Stripe stops delivering to it, which is the failure this guards.
 */
export function findEnabledEndpoint<T extends StripeWebhookEndpointLike>(
  endpoints: readonly T[],
  expectedUrl: string,
): T | null {
  return (
    findEndpointsForUrl(endpoints, expectedUrl).find(
      (endpoint) => endpoint.status === 'enabled',
    ) ?? null
  );
}

/**
 * Handled event types the endpoint does not subscribe to, sorted for a stable
 * message. `['*']` means every event, so nothing is missing.
 */
export function missingEventTypes(
  enabledEvents: readonly string[] | null | undefined,
  handled: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(enabledEvents)) return [...handled].sort();
  if (enabledEvents.includes('*')) return [];
  const enabled = new Set(enabledEvents);
  return [...handled].filter((type) => !enabled.has(type)).sort();
}
