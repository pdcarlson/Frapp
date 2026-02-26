import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type {
  IBillingProvider,
  CreateCheckoutParams,
} from '../../domain/adapters/billing.interface';

@Injectable()
export class StripeBillingService implements IBillingProvider {
  private readonly stripe: Stripe;
  private readonly priceId: string;

  constructor(private readonly config: ConfigService) {
    this.stripe = new Stripe(config.getOrThrow('STRIPE_SECRET_KEY'));
    this.priceId = config.getOrThrow('STRIPE_PRICE_ID');
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

  async getSubscriptionStatus(subscriptionId: string): Promise<string> {
    const subscription =
      await this.stripe.subscriptions.retrieve(subscriptionId);
    return subscription.status;
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.cancel(subscriptionId);
  }
}
