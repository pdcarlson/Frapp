import {
  expectedWebhookUrl,
  findEnabledEndpoint,
  findEndpointsForUrl,
  missingEventTypes,
  STRIPE_WEBHOOK_PATH,
  StripeWebhookEndpointMismatchError,
} from './stripe-webhook-consistency';
import { HANDLED_WEBHOOK_EVENT_TYPES } from './stripe-webhook-events';

describe('expectedWebhookUrl', () => {
  it('derives the endpoint from API_URL rather than hardcoding production', () => {
    expect(expectedWebhookUrl('https://api.frapp.live')).toBe(
      `https://api.frapp.live${STRIPE_WEBHOOK_PATH}`,
    );
    // Staging checks staging — the whole point of deriving it.
    expect(expectedWebhookUrl('https://api-staging.frapp.live')).toBe(
      `https://api-staging.frapp.live${STRIPE_WEBHOOK_PATH}`,
    );
  });

  it('ignores a path, trailing slash, and query on API_URL', () => {
    expect(expectedWebhookUrl('https://api.frapp.live/')).toBe(
      `https://api.frapp.live${STRIPE_WEBHOOK_PATH}`,
    );
    expect(expectedWebhookUrl('https://api.frapp.live/v1?x=1')).toBe(
      `https://api.frapp.live${STRIPE_WEBHOOK_PATH}`,
    );
  });

  it('skips IPv6 loopback — URL.hostname keeps the brackets', () => {
    // `new URL('https://[::1]').hostname` is '[::1]', never '::1', so the bare
    // comparison was dead code and an IPv6-only box would be refused boot.
    expect(expectedWebhookUrl('https://[::1]:3001')).toBeNull();
    expect(expectedWebhookUrl('https://[::1]')).toBeNull();
  });

  it('skips where Stripe could never deliver, so a laptop still boots', () => {
    // A developer with a real sk_test_ must not be refused for having no
    // publicly registered endpoint.
    for (const value of [
      undefined,
      null,
      '',
      '   ',
      'not a url',
      'http://api.frapp.live',
      'https://localhost:3001',
      'https://127.0.0.1:3001',
      'https://my-box.local',
      'https://192.168.1.10',
      'https://10.0.0.4',
    ]) {
      expect(expectedWebhookUrl(value)).toBeNull();
    }
  });
});

describe('findEnabledEndpoint', () => {
  const url = `https://api.frapp.live${STRIPE_WEBHOOK_PATH}`;

  it('matches the deployment URL, ignoring trailing slash and case', () => {
    const endpoint = { url: `${url}/`, status: 'enabled' };
    expect(findEnabledEndpoint([endpoint], url)).toBe(endpoint);
    const upper = { url: url.toUpperCase(), status: 'enabled' };
    expect(findEnabledEndpoint([upper], url)).toBe(upper);
  });

  it('refuses a DISABLED endpoint — Stripe stops delivering to it', () => {
    expect(findEnabledEndpoint([{ url, status: 'disabled' }], url)).toBeNull();
  });

  it('refuses an endpoint for a different deployment', () => {
    // The exact 2026-09-15 shape: staging endpoints exist, production has none.
    const staging = {
      url: `https://api-staging.frapp.live${STRIPE_WEBHOOK_PATH}`,
      status: 'enabled',
    };
    expect(findEnabledEndpoint([staging], url)).toBeNull();
  });

  it('returns null for an account with no endpoints at all', () => {
    // Live mode held nothing, which is why a test-mode whsec_ went unnoticed.
    expect(findEnabledEndpoint([], url)).toBeNull();
  });
});

describe('missingEventTypes', () => {
  it('names the handled types an endpoint does not subscribe to', () => {
    // Both endpoints registered 2026-08-27 enable five of six.
    const fiveOfSix = [
      'checkout.session.completed',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.paid',
      'payment_intent.succeeded',
    ];
    expect(missingEventTypes(fiveOfSix, HANDLED_WEBHOOK_EVENT_TYPES)).toEqual([
      'payment_intent.payment_failed',
    ]);
  });

  it('treats the wildcard as complete', () => {
    expect(missingEventTypes(['*'], HANDLED_WEBHOOK_EVENT_TYPES)).toEqual([]);
  });

  it('reports everything missing when the list is absent', () => {
    expect(missingEventTypes(null, HANDLED_WEBHOOK_EVENT_TYPES)).toHaveLength(
      HANDLED_WEBHOOK_EVENT_TYPES.size,
    );
  });

  it('is empty when the endpoint covers every handled type', () => {
    expect(
      missingEventTypes(
        [...HANDLED_WEBHOOK_EVENT_TYPES],
        HANDLED_WEBHOOK_EVENT_TYPES,
      ),
    ).toEqual([]);
  });
});

describe('StripeWebhookEndpointMismatchError', () => {
  it('names the expected URL and refuses to imply the secret was verified', () => {
    const err = new StripeWebhookEndpointMismatchError(
      `https://api.frapp.live${STRIPE_WEBHOOK_PATH}`,
      'account has no webhook endpoints at all',
    );
    expect(err.message).toContain('https://api.frapp.live/v1/webhooks/stripe');
    expect(err.message).toContain('no webhook endpoints at all');
    // The honest caveat has to survive refactors: a green boot is not proof.
    expect(err.message).toMatch(/cannot be verified/i);
  });

  it('never echoes a signing secret, because it is never given one', () => {
    const err = new StripeWebhookEndpointMismatchError('https://x/y', 'reason');
    expect(err.message).not.toMatch(/whsec_/);
  });
});

describe('findEnabledEndpoint — URL comparison', () => {
  const url = `https://api.frapp.live${STRIPE_WEBHOOK_PATH}`;

  it("ignores a query string, which Stripe's versioning runbook tells you to add", () => {
    const versioned = {
      url: `${url}?version=2026-08-26.dahlia`,
      status: 'enabled',
    };
    expect(findEnabledEndpoint([versioned], url)).toBe(versioned);
  });

  it('still refuses a different PATH on the same origin', () => {
    // Leniency about the query must not become leniency about the route.
    expect(
      findEnabledEndpoint(
        [
          {
            url: 'https://api.frapp.live/v2/webhooks/stripe',
            status: 'enabled',
          },
        ],
        url,
      ),
    ).toBeNull();
  });

  it('prefers the enabled endpoint when a disabled twin shares the URL', () => {
    // The exact mid-migration state: new endpoint live, old one disabled.
    const disabled = { url, status: 'disabled' };
    const enabled = {
      url: `${url}?version=2026-08-26.dahlia`,
      status: 'enabled',
    };
    expect(findEnabledEndpoint([disabled, enabled], url)).toBe(enabled);
    expect(findEndpointsForUrl([disabled, enabled], url)).toHaveLength(2);
  });
});
