import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { StripeWebhookConsistencyService } from './stripe-webhook-consistency.service';
import { StripeWebhookEndpointMismatchError } from './stripe-webhook-consistency';
import { HANDLED_WEBHOOK_EVENT_TYPES } from './stripe-webhook-events';

jest.mock('stripe');

const StripeCtor = Stripe as unknown as jest.Mock;

const REAL_SECRET = 'sk_live_webhook_gate_ok';
const API_URL = 'https://api.frapp.live';
const PROD_ENDPOINT = 'https://api.frapp.live/v1/webhooks/stripe';
const STAGING_ENDPOINT = 'https://api-staging.frapp.live/v1/webhooks/stripe';

describe('StripeWebhookConsistencyService', () => {
  const list = jest.fn();
  let warn: jest.SpyInstance;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    list.mockReset();
    StripeCtor.mockReset();
    StripeCtor.mockImplementation(() => ({
      webhookEndpoints: { list },
    }));
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function serviceWith(env: {
    secret?: string;
    apiUrl?: string;
  }): StripeWebhookConsistencyService {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'STRIPE_SECRET_KEY') return env.secret;
        if (key === 'API_URL') return env.apiUrl;
        return undefined;
      }),
    } as unknown as ConfigService;
    return new StripeWebhookConsistencyService(config);
  }

  const endpoint = (over: Partial<Stripe.WebhookEndpoint> = {}) =>
    ({
      url: PROD_ENDPOINT,
      status: 'enabled',
      enabled_events: [...HANDLED_WEBHOOK_EVENT_TYPES],
      ...over,
    }) as Stripe.WebhookEndpoint;

  it('refuses boot ONLY when the account has NO endpoints — the 2026-09-15 incident', () => {
    // Live mode held no endpoint at all, so production ran on a test-mode
    // whsec_ and every delivery failed signature verification, silently.
    list.mockResolvedValue({ data: [] });
    const service = serviceWith({ secret: REAL_SECRET, apiUrl: API_URL });
    return expect(service.assertRegisteredEndpoint()).rejects.toBeInstanceOf(
      StripeWebhookEndpointMismatchError,
    );
  });

  it('LOGS but does not refuse boot when only another environment has an endpoint', async () => {
    // Benign trigger: the endpoint is registered against the service's other
    // working hostname (frapp-api-prod.onrender.com before api.frapp.live's
    // DNS is live). Deliveries succeed; only this comparison disagrees.
    // Refusing here would trade a billing outage for a total one.
    list.mockResolvedValue({ data: [endpoint({ url: STAGING_ENDPOINT })] });
    const service = serviceWith({ secret: REAL_SECRET, apiUrl: API_URL });
    await expect(service.assertRegisteredEndpoint()).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('none for'));
  });

  it('LOGS but does not refuse boot when the matching endpoint is disabled', async () => {
    // Disable is one click in Workbench and the normal thing to do while
    // debugging a delivery failure. A restart in that window must not take
    // auth, chat and events down with billing.
    list.mockResolvedValue({ data: [endpoint({ status: 'disabled' })] });
    const service = serviceWith({ secret: REAL_SECRET, apiUrl: API_URL });
    await expect(service.assertRegisteredEndpoint()).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('none are enabled'),
    );
  });

  it("matches an endpoint carrying a query string — Stripe's own versioning runbook adds one", async () => {
    // docs.stripe.com/webhooks/versioning says to register the replacement as
    // `…/webhooks?version=YYYY-MM-DD` and disable the old one. Whole-string
    // comparison would call that a mismatch.
    list.mockResolvedValue({
      data: [endpoint({ url: `${PROD_ENDPOINT}?version=2026-08-26.dahlia` })],
    });
    const service = serviceWith({ secret: REAL_SECRET, apiUrl: API_URL });
    await expect(service.assertRegisteredEndpoint()).resolves.toBeUndefined();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('warns when API_URL is unset rather than skipping in silence', async () => {
    const service = serviceWith({ secret: REAL_SECRET, apiUrl: undefined });
    await expect(service.assertRegisteredEndpoint()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('API_URL'));
  });

  it('passes with an enabled endpoint for this deployment', async () => {
    list.mockResolvedValue({ data: [endpoint()] });
    const service = serviceWith({ secret: REAL_SECRET, apiUrl: API_URL });
    await expect(service.assertRegisteredEndpoint()).resolves.toBeUndefined();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('WARNS but does not refuse boot on a missing event type', async () => {
    // Deliberate, and still a warning: every registered endpoint is missing one
    // handled type today — the test-mode pair `payment_intent.payment_failed`
    // (#1978), the live-mode endpoint `customer.subscription.updated` (#2285) —
    // so making this fatal would refuse boot on production. #2287 tracks
    // tightening it and is blocked on both. The fixture below is the TEST-mode
    // shape only; #2287 adds the live-mode one, so do not read a green suite
    // here as evidence that flipping the guard is safe.
    const fiveOfSix = [...HANDLED_WEBHOOK_EVENT_TYPES].filter(
      (t) => t !== 'payment_intent.payment_failed',
    );
    list.mockResolvedValue({ data: [endpoint({ enabled_events: fiveOfSix })] });
    const service = serviceWith({ secret: REAL_SECRET, apiUrl: API_URL });
    await expect(service.assertRegisteredEndpoint()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('payment_intent.payment_failed'),
    );
  });

  it('does not call Stripe for a placeholder secret', async () => {
    const service = serviceWith({
      secret: 'sk_test_placeholder_cloud_sandbox',
      apiUrl: API_URL,
    });
    await expect(service.assertRegisteredEndpoint()).resolves.toBeUndefined();
    expect(StripeCtor).not.toHaveBeenCalled();
  });

  it('does not call Stripe when API_URL is loopback or unset', async () => {
    for (const apiUrl of [undefined, 'http://localhost:3001']) {
      const service = serviceWith({ secret: REAL_SECRET, apiUrl });
      await expect(service.assertRegisteredEndpoint()).resolves.toBeUndefined();
    }
    expect(StripeCtor).not.toHaveBeenCalled();
  });

  it('swallows a transient Stripe error rather than cancelling a deploy', async () => {
    list.mockRejectedValue(new Error('ETIMEDOUT'));
    const service = serviceWith({ secret: REAL_SECRET, apiUrl: API_URL });
    await expect(service.assertRegisteredEndpoint()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('transient'));
  });
});
