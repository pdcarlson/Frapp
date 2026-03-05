import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type {
  IBillingProvider,
  CreateCheckoutParams,
  CreateCustomerPortalParams,
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
