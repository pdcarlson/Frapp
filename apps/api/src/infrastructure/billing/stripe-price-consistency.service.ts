import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  isStripePriceMisconfigurationError,
  shouldSkipStripePriceConsistency,
  StripePriceAccountMismatchError,
} from './stripe-price-consistency';

const PRICE_RETRIEVE_TIMEOUT_MS = 8_000;

@Injectable()
export class StripePriceConsistencyService implements OnModuleInit {
  private readonly logger = new Logger(StripePriceConsistencyService.name);

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.assertConfiguredPrice();
  }

  /**
   * Retrieve `STRIPE_PRICE_ID` with the configured secret. Throws
   * {@link StripePriceAccountMismatchError} when the Price is missing, on a
   * different account, or inactive. Placeholder secrets return without calling
   * Stripe. Transient Stripe errors are logged and swallowed so a network blip
   * cannot cancel a deploy; `/health` liveness never calls this.
   */
  async assertConfiguredPrice(): Promise<void> {
    const secret = this.config.get<string>('STRIPE_SECRET_KEY');
    if (shouldSkipStripePriceConsistency(secret) || !secret) {
      return;
    }

    const priceId = this.config.get<string>('STRIPE_PRICE_ID')?.trim() ?? '';
    if (!priceId) {
      const err = new StripePriceAccountMismatchError(
        '(empty)',
        'STRIPE_PRICE_ID is empty',
      );
      this.logger.error(err.message);
      throw err;
    }

    try {
      const stripe = new Stripe(secret, {
        timeout: PRICE_RETRIEVE_TIMEOUT_MS,
        maxNetworkRetries: 0,
      });
      const price = await stripe.prices.retrieve(priceId);
      if (price.active !== true) {
        const err = new StripePriceAccountMismatchError(
          priceId,
          'configured Price is inactive',
        );
        this.logger.error(err.message);
        throw err;
      }
    } catch (error) {
      if (error instanceof StripePriceAccountMismatchError) {
        throw error;
      }
      if (isStripePriceMisconfigurationError(error)) {
        const reason = stripeReason(error);
        const err = new StripePriceAccountMismatchError(priceId, reason);
        this.logger.error(err.message);
        throw err;
      }
      const detail =
        error instanceof Error ? error.message : 'unknown Stripe error';
      this.logger.warn(
        `Stripe price consistency check skipped after a transient error (${detail}); not refusing boot`,
      );
    }
  }
}

function stripeReason(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Stripe rejected the Price';
  const candidate = error as { code?: unknown; message?: unknown };
  const code =
    typeof candidate.code === 'string' ? candidate.code : 'unknown_code';
  const message =
    typeof candidate.message === 'string' ? candidate.message : 'no message';
  return `${code}: ${message}`;
}
