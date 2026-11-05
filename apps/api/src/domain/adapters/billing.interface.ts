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
  /**
   * The API version this payload was rendered at: the endpoint's own pin, or
   * the account default when the endpoint has none. Logged per event so the
   * live endpoint's version shows up in production logs (#3204). Null on
   * events Stripe sends without one.
   */
  api_version?: string | null;
  data: {
    object: TObject;
  };
}

export interface CheckoutSessionWebhookObject {
  metadata?: {
    chapter_id?: string;
  };
  subscription?: string | null;
  customer?: string | { id: string } | null;
}

export interface SubscriptionWebhookObject {
  id: string;
  status?: string;
  // Stripe sends the customer as an id string on webhook payloads, an expanded
  // object only under explicit expansion, or null for a deleted customer —
  // normalize via customerIdFrom. Read by `findChapterBySubscription`'s
  // customer fallback (#1738).
  customer?: string | { id: string } | null;
}

/**
 * The `invoice.*` webhook object, as far as the billing handler reads it.
 *
 * Since API version 2025-03-31.basil Stripe puts the subscription id at
 * `parent.subscription_details.subscription` and no longer sends a top-level
 * `subscription` (#3204). A webhook payload follows its endpoint's own
 * `api_version`, or the account default when that is null, never the SDK's
 * pinned version, so the shape here is set in the Stripe dashboard, not in
 * code. Which version each endpoint receives:
 * `docs/ops/deployment/integrations.md` § 7.1.
 */
export interface InvoiceWebhookObject {
  id?: string;
  parent?: {
    type?: string;
    subscription_details?: {
      // An id string on webhook payloads; an expanded object only under
      // explicit expansion.
      subscription?: string | { id: string } | null;
    } | null;
  } | null;
  /**
   * Pre-Basil payloads only. Kept as a read fallback on purpose: the live
   * endpoint shows 2026-08-26.dahlia, but whether that is a pin or the
   * account default isn't recorded (docs/ops/deployment/integrations.md § 7),
   * and reading one extra field costs nothing.
   */
  subscription?: string | { id: string } | null;
  customer?: string | { id: string } | null;
}

/**
 * The subscription a paid invoice belongs to, from the Basil-and-later
 * `parent.subscription_details` first, then the pre-Basil top-level field.
 * Null for an invoice no subscription generated (a one-off or quote invoice).
 */
export function invoiceSubscriptionId(
  invoice: InvoiceWebhookObject,
): string | null {
  return stripeRefId(
    invoice.parent?.subscription_details?.subscription ?? invoice.subscription,
  );
}

/**
 * Normalize a Stripe object reference: an id string on webhook payloads, an
 * expanded object only under explicit expansion, or null.
 */
function stripeRefId(
  ref: string | { id: string } | null | undefined,
): string | null {
  return typeof ref === 'string' ? ref : (ref?.id ?? null);
}

/** Normalize a Stripe `customer` reference (id, expanded object, or null). */
export function customerIdFrom(
  customer: string | { id: string } | null | undefined,
): string | null {
  return stripeRefId(customer);
}

export interface PaymentIntentLastPaymentError {
  message?: string | null;
  decline_code?: string | null;
  code?: string | null;
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
  last_payment_error?: PaymentIntentLastPaymentError | null;
}

/** Normalize Stripe's `latest_charge` (id, expanded object, or null). */
export function chargeIdFromLatestCharge(
  latestCharge: string | { id: string } | null | undefined,
): string | null {
  return stripeRefId(latestCharge);
}

/** Cap so a Stripe decline string cannot blow a notification body. */
const DECLINE_REASON_MAX_LENGTH = 180;

/**
 * Member-facing decline text from a `payment_intent.payment_failed` payload.
 * Prefers Stripe's `message` (already written for the cardholder) over codes.
 */
export function declineReasonFromLastPaymentError(
  lastPaymentError: PaymentIntentLastPaymentError | null | undefined,
): string | null {
  const raw = [
    lastPaymentError?.message,
    lastPaymentError?.decline_code,
    lastPaymentError?.code,
  ]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find((value) => value.length > 0);
  if (!raw) return null;
  return raw.length > DECLINE_REASON_MAX_LENGTH
    ? `${raw.slice(0, DECLINE_REASON_MAX_LENGTH)}…`
    : raw;
}

export type WebhookEvent =
  | BaseWebhookEvent<'checkout.session.completed', CheckoutSessionWebhookObject>
  | BaseWebhookEvent<'customer.subscription.updated', SubscriptionWebhookObject>
  | BaseWebhookEvent<'customer.subscription.deleted', SubscriptionWebhookObject>
  | BaseWebhookEvent<'invoice.paid', InvoiceWebhookObject>
  | BaseWebhookEvent<'payment_intent.succeeded', PaymentIntentWebhookObject>
  | BaseWebhookEvent<
      'payment_intent.payment_failed',
      PaymentIntentWebhookObject
    >
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
