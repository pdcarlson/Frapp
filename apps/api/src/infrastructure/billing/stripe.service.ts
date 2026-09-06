import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  chargeIdFromLatestCharge,
  type IBillingProvider,
  type CreateCheckoutParams,
  type CreateCustomerPortalParams,
  type CreatePaymentIntentParams,
  type PaymentIntentResult,
  type WebhookEvent,
} from '#domain/adapters/billing.interface';

/**
 * The trial the public site sells (#913). `apps/landing/app/page.tsx` labels the
 * CTA "Start free trial" (`:440`), promises "every new chapter starts with a
 * 14-day trial" (`:99`), and repeats it in the hero trust line (`:211`) — so a
 * checkout session that charges on day zero breaks a commercial promise, not
 * just a spec.
 *
 * It has to live here rather than on the Price: Stripe's Price object has no
 * writable trial field, so `subscription_data.trial_period_days` on the
 * Checkout Session is the only place a trial can be set. Swapping in a
 * different Price ID cannot change it.
 *
 * No database change rides along. Stripe reports a trialing subscription as
 * `trialing`, which `BillingService.mapStripeStatus` already folds into
 * `active` (`billing.service.ts:596`), and `active` is already one of the four
 * values the `subscription_status` CHECK allows. A trialing chapter is
 * therefore a fully active chapter to every permission gate — which is the
 * intent: the trial is a free window, not a degraded tier.
 *
 * Whether a given checkout may open one is `params.grantTrial`, decided by the
 * caller: this layer cannot see billing history, and the trial is once per
 * chapter rather than once per checkout session. That stays true even now that
 * the session is tied to the chapter's own `customer` (#929): Stripe would only
 * refuse a repeat trial on a customer it can recognise, and `grantTrial` is
 * keyed on our own record of having held a subscription, which is the stronger
 * signal. It remains the boundary, not a second line of defence.
 */
const TRIAL_PERIOD_DAYS = 14;

@Injectable()
export class StripeBillingService implements IBillingProvider {
  private readonly logger = new Logger(StripeBillingService.name);
  private readonly stripe: Stripe;
  private readonly priceId: string;
  private readonly webhookSecret: string;

  constructor(private readonly config: ConfigService) {
    const secretKey = config.getOrThrow<string>('STRIPE_SECRET_KEY');
    this.priceId = config.getOrThrow<string>('STRIPE_PRICE_ID');
    this.webhookSecret = config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');
    this.stripe = new Stripe(secretKey);
  }

  async createCustomer(email: string, name: string): Promise<string> {
    const customer = await this.stripe.customers.create({ email, name });
    return customer.id;
  }

  async createCheckoutSession(params: CreateCheckoutParams): Promise<string> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      // The chapter's own customer, never `customer_email` (#929). Stripe mints
      // a fresh Customer for an email it is given, so passing one here meant a
      // repeat checkout could not be recognised as the same chapter — the
      // second subscription landed on a second customer and the first was
      // orphaned. `customer` is also what makes Stripe's own trial history
      // meaningful, since that history hangs off the Customer.
      customer: params.customerId,
      line_items: [{ price: this.priceId, quantity: 1 }],
      ...(params.grantTrial
        ? { subscription_data: { trial_period_days: TRIAL_PERIOD_DAYS } }
        : {}),
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: { chapter_id: params.chapterId },
    });
    return session.url!;
  }

  async createCustomerPortalSession(
    params: CreateCustomerPortalParams,
  ): Promise<string> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: params.customerId,
      return_url: params.returnUrl,
    });
    return session.url;
  }

  async createPaymentIntent(
    params: CreatePaymentIntentParams,
  ): Promise<PaymentIntentResult> {
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: params.amount,
        currency: params.currency,
        metadata: params.metadata,
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey: params.idempotencyKey },
    );
    return this.toPaymentIntentResult(intent);
  }

  async getPaymentIntent(
    paymentIntentId: string,
  ): Promise<PaymentIntentResult | null> {
    try {
      const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      return this.toPaymentIntentResult(intent);
    } catch (error) {
      // A permanently unknown id (key/account migration, restored data) is a
      // "mint a fresh intent" signal, not an outage — surface it as null so
      // callers don't loop on a misleading 503.
      if (
        error instanceof Stripe.errors.StripeInvalidRequestError &&
        error.code === 'resource_missing'
      ) {
        return null;
      }
      throw error;
    }
  }

  async cancelPaymentIntent(paymentIntentId: string): Promise<void> {
    try {
      await this.stripe.paymentIntents.cancel(paymentIntentId);
    } catch (error) {
      // Already succeeded/canceled, or unknown to this account — nothing left
      // to cancel, so don't fail the caller's transition. Still surface it:
      // `payment_intent_unexpected_state` also covers an intent that is
      // `processing`, i.e. money in flight against an invoice being closed —
      // silence there would hide a real reconciliation case.
      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        if (error.code === 'resource_missing') {
          // The account has no such intent (e.g. an id stored under an old
          // key) — there is provably no money in flight, so don't dilute the
          // reconciliation signal below.
          this.logger.debug(
            `PaymentIntent ${paymentIntentId} not found while canceling; nothing to cancel`,
          );
          return;
        }
        this.logger.warn(
          `PaymentIntent ${paymentIntentId} could not be canceled (${error.code ?? 'unknown code'}): ${error.message} — if it was mid-payment, the charge may still settle`,
        );
        return;
      }
      throw error;
    }
  }

  private toPaymentIntentResult(
    intent: Stripe.PaymentIntent,
  ): PaymentIntentResult {
    return {
      id: intent.id,
      status: intent.status,
      clientSecret: intent.client_secret,
      latestChargeId: chargeIdFromLatestCharge(intent.latest_charge),
    };
  }

  constructWebhookEvent(payload: Buffer, signature: string): WebhookEvent {
    const event = this.stripe.webhooks.constructEvent(
      payload,
      signature,
      this.webhookSecret,
    );

    return {
      id: event.id,
      type: event.type,
      created: event.created,
      data: {
        object: event.data.object as unknown as Record<string, unknown>,
      },
    };
  }
}
