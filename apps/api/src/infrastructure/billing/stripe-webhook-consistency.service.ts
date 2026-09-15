import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { shouldSkipStripePriceConsistency } from './stripe-price-consistency';
import {
  expectedWebhookUrl,
  findEnabledEndpoint,
  missingEventTypes,
  StripeWebhookEndpointMismatchError,
} from './stripe-webhook-consistency';
import { HANDLED_WEBHOOK_EVENT_TYPES } from './stripe-webhook-events';

const WEBHOOK_LIST_TIMEOUT_MS = 8_000;

/** One page covers any plausible number of endpoints for one account. */
const WEBHOOK_LIST_LIMIT = 100;

@Injectable()
export class StripeWebhookConsistencyService implements OnModuleInit {
  private readonly logger = new Logger(StripeWebhookConsistencyService.name);

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.assertRegisteredEndpoint();
  }

  /**
   * List the webhook endpoints on `STRIPE_SECRET_KEY`'s account and require an
   * enabled one for this deployment's own URL. Throws
   * {@link StripeWebhookEndpointMismatchError} when none exists.
   *
   * A subscribed-events gap only WARNS. Making it fatal would refuse boot on
   * both endpoints registered on 2026-08-27, which enable five of the six
   * handled types — turning a missing payment-failure notification into an
   * outage. Tighten to fatal once those are corrected.
   *
   * Transient Stripe errors are logged and swallowed, matching the price check:
   * a network blip must not cancel a deploy.
   */
  async assertRegisteredEndpoint(): Promise<void> {
    const secret = this.config.get<string>('STRIPE_SECRET_KEY');
    if (shouldSkipStripePriceConsistency(secret) || !secret) {
      return;
    }

    const expectedUrl = expectedWebhookUrl(this.config.get<string>('API_URL'));
    if (!expectedUrl) {
      // No publicly reachable API_URL, so no endpoint could be registered for
      // it. A laptop or CI box with a real test key is not a misconfiguration.
      return;
    }

    let endpoints: Stripe.WebhookEndpoint[];
    try {
      const stripe = new Stripe(secret, {
        timeout: WEBHOOK_LIST_TIMEOUT_MS,
        maxNetworkRetries: 0,
      });
      const page = await stripe.webhookEndpoints.list({
        limit: WEBHOOK_LIST_LIMIT,
      });
      endpoints = page.data;
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'unknown Stripe error';
      this.logger.warn(
        `Stripe webhook consistency check skipped after a transient error (${detail}); not refusing boot`,
      );
      return;
    }

    const endpoint = findEnabledEndpoint(endpoints, expectedUrl);
    if (!endpoint) {
      const reason = endpoints.length
        ? `account has ${endpoints.length} endpoint(s), none enabled for this URL`
        : 'account has no webhook endpoints at all';
      const err = new StripeWebhookEndpointMismatchError(expectedUrl, reason);
      this.logger.error(err.message);
      throw err;
    }

    const missing = missingEventTypes(
      endpoint.enabled_events,
      HANDLED_WEBHOOK_EVENT_TYPES,
    );
    if (missing.length) {
      this.logger.warn(
        `Stripe endpoint ${expectedUrl} does not subscribe to ${missing.join(', ')} — ` +
          'these are handled by billing.service.ts and will never arrive. Add them in the Stripe dashboard.',
      );
    }
  }
}
