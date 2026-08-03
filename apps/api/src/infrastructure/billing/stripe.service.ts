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
} from '../../domain/adapters/billing.interface';

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
      customer_email: params.customerEmail,
      line_items: [{ price: this.priceId, quantity: 1 }],
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

  async getSubscriptionStatus(subscriptionId: string): Promise<string> {
    const subscription =
      await this.stripe.subscriptions.retrieve(subscriptionId);
    return subscription.status;
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.cancel(subscriptionId);
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
