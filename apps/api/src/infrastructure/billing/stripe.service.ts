import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type {
  IBillingProvider,
  CreateCheckoutParams,
  CreateCustomerPortalParams,
  CreatePaymentIntentParams,
  PaymentIntentResult,
  WebhookEvent,
} from '../../domain/adapters/billing.interface';

@Injectable()
export class StripeBillingService implements IBillingProvider {
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
    const intent = await this.stripe.paymentIntents.create({
      amount: params.amount,
      currency: params.currency,
      metadata: params.metadata,
      automatic_payment_methods: { enabled: true },
    });
    return this.toPaymentIntentResult(intent);
  }

  async getPaymentIntent(
    paymentIntentId: string,
  ): Promise<PaymentIntentResult> {
    const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
    return this.toPaymentIntentResult(intent);
  }

  private toPaymentIntentResult(
    intent: Stripe.PaymentIntent,
  ): PaymentIntentResult {
    // latest_charge is a charge id, an expanded charge object, or null
    // depending on payload expansion.
    const latestCharge = intent.latest_charge;
    const latestChargeId =
      typeof latestCharge === 'string'
        ? latestCharge
        : (latestCharge?.id ?? null);
    return {
      id: intent.id,
      status: intent.status,
      clientSecret: intent.client_secret,
      latestChargeId,
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
