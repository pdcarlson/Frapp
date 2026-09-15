import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { shouldSkipStripePriceConsistency } from './stripe-price-consistency';
import {
  expectedWebhookUrl,
  findEnabledEndpoint,
  findEndpointsForUrl,
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
   * List the webhook endpoints on `STRIPE_SECRET_KEY`'s account and check that
   * one is registered for this deployment's own URL.
   *
   * ONLY ONE CONDITION IS FATAL: the account has no webhook endpoints at all.
   * That is the 2026-09-15 incident exactly — Signet live mode was empty — and
   * it has no benign cause: a real key, a public URL, and zero endpoints is
   * unambiguously an unconfigured environment.
   *
   * Everything else WARNS, because this guard can take the whole API down —
   * auth, chat, events — for a condition that only breaks billing, and the
   * benign triggers are real:
   *
   *   - An endpoint disabled for twenty minutes while someone debugs a delivery
   *     failure in Workbench. A routine restart in that window would otherwise
   *     be a total outage.
   *   - An endpoint registered against the service's other working hostname
   *     (`frapp-api-prod.onrender.com` before `api.frapp.live`'s DNS is live —
   *     see bootstrap.ts). Deliveries succeed; only this string comparison
   *     disagrees.
   *   - A subscribed-events gap. The two TEST-mode endpoints registered
   *     2026-08-27 enable five of the six handled types; the live-mode endpoint
   *     created 2026-09-15 has all six. Tighten this to fatal once the
   *     test-mode pair is corrected.
   *
   * Trading silent billing breakage for a possible outage is the wrong trade
   * whenever the guard might be the stale party rather than the config.
   *
   * Transient Stripe errors are logged and swallowed, matching the price check:
   * a network blip must not cancel a deploy.
   */
  async assertRegisteredEndpoint(): Promise<void> {
    const secret = this.config.get<string>('STRIPE_SECRET_KEY');
    if (shouldSkipStripePriceConsistency(secret) || !secret) {
      return;
    }

    const apiUrl = this.config.get<string>('API_URL');
    const expectedUrl = expectedWebhookUrl(apiUrl);
    if (!expectedUrl) {
      // No publicly reachable API_URL, so no endpoint could be registered for
      // it. A laptop or CI box with a real test key is not a misconfiguration.
      //
      // Logged rather than returned in silence: API_URL is NOT in
      // REQUIRED_ENV_VARS, so a deployment that loses it would skip this check
      // entirely and produce a boot log indistinguishable from a passing one —
      // which is how the incident this guard exists for went unnoticed.
      this.logger.warn(
        `Stripe webhook consistency check skipped: API_URL is ${
          apiUrl ? `"${apiUrl}"` : 'unset'
        }, which is not a public https origin Stripe could deliver to. ` +
          'Expected in staging and production.',
      );
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

    if (endpoints.length === 0) {
      const err = new StripeWebhookEndpointMismatchError(
        expectedUrl,
        'account has no webhook endpoints at all',
      );
      this.logger.error(err.message);
      throw err;
    }

    const endpoint = findEnabledEndpoint(endpoints, expectedUrl);
    if (!endpoint) {
      const forUrl = findEndpointsForUrl(endpoints, expectedUrl);
      this.logger.error(
        forUrl.length
          ? `Stripe has ${forUrl.length} endpoint(s) for ${expectedUrl} but none are enabled — ` +
              'deliveries are not being sent. Re-enable it in the Stripe dashboard.'
          : `Stripe has ${endpoints.length} endpoint(s) on this account but none for ${expectedUrl} — ` +
              'either this deployment receives no webhooks, or the endpoint is registered ' +
              'against a different hostname for the same service. Not refusing boot, because ' +
              'that would trade a billing outage for a total one.',
      );
      return;
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
