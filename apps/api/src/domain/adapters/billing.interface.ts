export const BILLING_PROVIDER = 'BILLING_PROVIDER';

export interface CreateCheckoutParams {
  chapterId: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export interface IBillingProvider {
  createCustomer(email: string, name: string): Promise<string>;
  createCheckoutSession(params: CreateCheckoutParams): Promise<string>;
  getSubscriptionStatus(subscriptionId: string): Promise<string>;
  cancelSubscription(subscriptionId: string): Promise<void>;
}
