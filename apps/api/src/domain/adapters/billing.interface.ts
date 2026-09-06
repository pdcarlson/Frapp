export const BILLING_PROVIDER = 'BILLING_PROVIDER';

export interface CreateCheckoutParams {
  chapterId: string;
  /**
   * The chapter's existing Stripe customer, which the caller resolves (creating
   * one first if the chapter has none) before ever reaching this adapter.
   *
   * This is deliberately the *only* way to identify a customer here — there is
   * no `customerEmail` escape hatch (#929). Letting the adapter fall back to an
   * email is what made Stripe mint a brand-new Customer on every checkout, so a
   * chapter that already owned a subscription got a second one against a second
   * customer record, and the first was orphaned where nothing in the app could
   * see or cancel it. One field, always populated, makes that unrepresentable
   * rather than merely guarded against.
   */
  customerId: string;
  successUrl: string;
  cancelUrl: string;
  /**
   * Whether this checkout may open a free trial. Decided by the caller, which
   * is the only layer that can see the chapter's billing history — the trial is
   * once per chapter, not once per checkout session, and nothing downstream can
   * tell a first subscription from a fifth.
   */
  grantTrial: boolean;
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
  // payload expansion — normalize via chargeIdFromLatestCharge.
  latest_charge?: string | { id: string } | null;
  amount?: number;
}

/** Normalize Stripe's `latest_charge` (id, expanded object, or null). */
export function chargeIdFromLatestCharge(
  latestCharge: string | { id: string } | null | undefined,
): string | null {
  return typeof latestCharge === 'string'
    ? latestCharge
    : (latestCharge?.id ?? null);
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
  // Provider-side dedupe: concurrent create calls with the same key return
  // the same intent instead of minting (and charging) twice.
  idempotencyKey: string;
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
  createPaymentIntent(
    params: CreatePaymentIntentParams,
  ): Promise<PaymentIntentResult>;
  /** Null when the intent no longer exists at the provider (e.g. key/account
   * migration) — callers treat that as "mint a fresh one", not an outage. */
  getPaymentIntent(
    paymentIntentId: string,
  ): Promise<PaymentIntentResult | null>;
  /** Best-effort cancel so an outstanding client secret can no longer be
   * confirmed. Already-terminal intents are treated as success. */
  cancelPaymentIntent(paymentIntentId: string): Promise<void>;
  constructWebhookEvent(payload: Buffer, signature: string): WebhookEvent;
}
