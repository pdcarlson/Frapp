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

export type WebhookEvent =
  | BaseWebhookEvent<'checkout.session.completed', CheckoutSessionWebhookObject>
  | BaseWebhookEvent<'customer.subscription.updated', SubscriptionWebhookObject>
  | BaseWebhookEvent<'customer.subscription.deleted', SubscriptionWebhookObject>
  | BaseWebhookEvent<'invoice.paid', InvoiceWebhookObject>
  | BaseWebhookEvent<string, Record<string, unknown>>;

export interface IBillingProvider {
  createCustomer(email: string, name: string): Promise<string>;
  createCheckoutSession(params: CreateCheckoutParams): Promise<string>;
  createCustomerPortalSession(
    params: CreateCustomerPortalParams,
  ): Promise<string>;
  getSubscriptionStatus(subscriptionId: string): Promise<string>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  constructWebhookEvent(payload: Buffer, signature: string): WebhookEvent;
}
