export enum BillingStatus {
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  CANCELED = 'canceled',
  INCOMPLETE = 'incomplete',
}

export interface BillingEvent {
  type:
    | 'subscription.created'
    | 'subscription.updated'
    | 'subscription.deleted';
  stripeCustomerId: string;
  subscriptionId: string;
  status: BillingStatus;
}

export const BILLING_PROVIDER = 'BILLING_PROVIDER';

export interface IBillingProvider {
  /**
   * Creates a customer in the billing system.
   */
  createCustomer(email: string, name: string): Promise<string>;

  /**
   * Generates a hosted checkout URL for the user to start a subscription.
   */
  createCheckoutSession(
    customerId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<string>;

  /**
   * Verifies the integrity of a webhook payload.
   * Returns a normalized BillingEvent or null if the event is not relevant.
   */
  verifyWebhook(
    payload: any,
    signature: string,
    secret: string,
  ): BillingEvent | null;
}
