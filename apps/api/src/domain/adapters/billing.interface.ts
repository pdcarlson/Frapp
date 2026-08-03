export const BILLING_PROVIDER = 'BILLING_PROVIDER';

export interface CreateCheckoutParams {
  chapterId: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CreateCustomerPortalParams {
  customerId: string;
  returnUrl: string;
}

interface BaseWebhookEvent<TType extends string, TObject> {
  id: string;
  type: TType;
  created: number;
  data: {
    object: TObject;
  };
}

export interface CheckoutSessionWebhookObject {
  metadata?: {
    chapter_id?: string;
  };
  subscription?: string | null;
  customer?: string | null;
}

export interface SubscriptionWebhookObject {
  id: string;
  status?: string;
}

export interface InvoiceWebhookObject {
  subscription?: string | null;
}

export interface PaymentIntentWebhookObject {
  id: string;
  metadata?: {
    invoice_id?: string;
    chapter_id?: string;
    user_id?: string;
  };
  // Stripe sends a charge id, an expanded charge object, or null depending on
  // payload expansion — consumers must normalize.
  latest_charge?: string | { id: string } | null;
  amount?: number;
}

export type WebhookEvent =
  | BaseWebhookEvent<'checkout.session.completed', CheckoutSessionWebhookObject>
  | BaseWebhookEvent<'customer.subscription.updated', SubscriptionWebhookObject>
  | BaseWebhookEvent<'customer.subscription.deleted', SubscriptionWebhookObject>
  | BaseWebhookEvent<'invoice.paid', InvoiceWebhookObject>
  | BaseWebhookEvent<'payment_intent.succeeded', PaymentIntentWebhookObject>
  | BaseWebhookEvent<string, Record<string, unknown>>;

export interface CreatePaymentIntentParams {
  amount: number; // integer cents
  currency: string;
  metadata: {
    invoice_id: string;
    chapter_id: string;
    user_id: string;
  };
}

export interface PaymentIntentResult {
  id: string;
  status: string;
  clientSecret: string | null;
  latestChargeId: string | null;
}

export interface IBillingProvider {
  createCustomer(email: string, name: string): Promise<string>;
  createCheckoutSession(params: CreateCheckoutParams): Promise<string>;
  createCustomerPortalSession(
    params: CreateCustomerPortalParams,
  ): Promise<string>;
  getSubscriptionStatus(subscriptionId: string): Promise<string>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  createPaymentIntent(
    params: CreatePaymentIntentParams,
  ): Promise<PaymentIntentResult>;
  getPaymentIntent(paymentIntentId: string): Promise<PaymentIntentResult>;
  constructWebhookEvent(payload: Buffer, signature: string): WebhookEvent;
}
