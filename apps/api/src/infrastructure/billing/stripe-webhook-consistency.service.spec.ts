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

  it('refuses boot when the account has NO endpoints — the 2026-09-15 incident', () => {
    // Live mode held no endpoint at all, so production ran on a test-mode
    // whsec_ and every delivery failed signature verification, silently.
    list.mockResolvedValue({ data: [] });
    const service = serviceWith({ secret: REAL_SECRET, apiUrl: API_URL });
    return expect(service.assertRegisteredEndpoint()).rejects.toBeInstanceOf(
      StripeWebhookEndpointMismatchError,
    );
  });

  it('refuses boot when only another environment has an endpoint', async () => {
    list.mockResolvedValue({ data: [endpoint({ url: STAGING_ENDPOINT })] });
    const service = serviceWith({ secret: REAL_SECRET, apiUrl: API_URL });
    await expect(service.assertRegisteredEndpoint()).rejects.toThrow(
      /no enabled webhook endpoint/i,
    );
    expect(errorLog).toHaveBeenCalled();
  });

  it('refuses boot when the matching endpoint is disabled', async () => {
    list.mockResolvedValue({ data: [endpoint({ status: 'disabled' })] });
    const service = serviceWith({ secret: REAL_SECRET, apiUrl: API_URL });
    await expect(service.assertRegisteredEndpoint()).rejects.toThrow(
      StripeWebhookEndpointMismatchError,
    );
  });

  it('passes with an enabled endpoint for this deployment', async () => {
    list.mockResolvedValue({ data: [endpoint()] });
    const service = serviceWith({ secret: REAL_SECRET, apiUrl: API_URL });
    await expect(service.assertRegisteredEndpoint()).resolves.toBeUndefined();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('WARNS but does not refuse boot on a missing event type', async () => {
    // Deliberate: both endpoints registered 2026-08-27 enable five of six, so
    // fatal here would turn a missing notification into an outage.
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
