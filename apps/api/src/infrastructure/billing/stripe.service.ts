import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  IBillingProvider,
  BillingEvent,
  BillingStatus,
} from '../../domain/adapters/billing.interface';

@Injectable()
export class StripeService implements IBillingProvider {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(StripeService.name);

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not defined');
    }
    this.stripe = new Stripe(secretKey);
  }

  async createCustomer(email: string, name: string): Promise<string> {
    try {
      const customer = await this.stripe.customers.create({
        email,
        name,
      });
      return customer.id;
    } catch (error) {
      this.logger.error('Failed to create Stripe customer', error);
      throw error;
    }
  }

  async createCheckoutSession(
    customerId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<string> {
    try {
      const session = await this.stripe.checkout.sessions.create({
        customer: customerId,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      if (!session.url) {
        throw new Error('Stripe session URL is missing');
      }

      return session.url;
    } catch (error) {
      this.logger.error('Failed to create Stripe checkout session', error);
      throw error;
    }
  }

  async createInvoiceCheckout(
    customerId: string,
    amount: number,
    title: string,
    successUrl: string,
    cancelUrl: string,
    metadata?: Record<string, string>,
  ): Promise<string> {
    try {
      const session = await this.stripe.checkout.sessions.create({
        customer: customerId,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: title,
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: metadata,
        payment_intent_data: {
          metadata: metadata, // Propagate metadata to PaymentIntent for webhooks
        },
      });

      if (!session.url) {
        throw new Error('Stripe session URL is missing');
      }

      return session.url;
    } catch (error) {
      this.logger.error('Failed to create Stripe invoice checkout', error);
      throw error;
    }
  }

  verifyWebhook(
    payload: string | Buffer,
    signature: string,
    secret: string,
  ): BillingEvent | null {
    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        secret,
      );

      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          const subscription = event.data.object;
          return {
            type: this.mapStripeType(event.type),
            stripeCustomerId: subscription.customer as string,
            subscriptionId: subscription.id,
            status: this.mapStripeStatus(subscription.status),
          };
        }
        case 'checkout.session.completed': {
          const session = event.data.object;
          if (session.mode === 'payment' && session.payment_status === 'paid') {
            return {
              type: 'invoice.payment_succeeded',
              stripeCustomerId: session.customer as string,
              paymentIntentId: session.payment_intent as string,
              status: BillingStatus.ACTIVE, // Paid
              metadata: session.metadata || undefined,
            };
          }
          return null;
        }
        default:
          return null;
      }
    } catch (error) {
      this.logger.error('Webhook signature verification failed', error);
      throw error;
    }
  }

  private mapStripeStatus(status: Stripe.Subscription.Status): BillingStatus {
    switch (status) {
      case 'active':
        return BillingStatus.ACTIVE;
      case 'past_due':
      case 'unpaid':
        return BillingStatus.PAST_DUE;
      case 'canceled':
      case 'incomplete_expired':
        return BillingStatus.CANCELED;
      default:
        return BillingStatus.INCOMPLETE;
    }
  }

  private mapStripeType(
    type: string,
  ): 'subscription.created' | 'subscription.updated' | 'subscription.deleted' {
    if (type.includes('created')) return 'subscription.created';
    if (type.includes('updated')) return 'subscription.updated';
    return 'subscription.deleted';
  }
}
