export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'VOID';

export interface FinancialInvoice {
  id: string;
  chapter_id: string;
  user_id: string;
  title: string;
  description: string | null;
  amount: number;
  status: InvoiceStatus;
  due_date: string;
  paid_at: string | null;
  stripe_payment_intent_id: string | null;
  /**
   * Payment-attempt state (#3460, `spec/behavior/billing.md` § Member payment
   * flow). The pay endpoint stamps `last_payment_attempt_at` and clears the
   * failure pair on every new attempt; the `payment_intent.payment_failed`
   * webhook sets the pair. A non-null `last_payment_failed_at` on an OPEN
   * invoice means the latest payment on the stored intent failed; a member
   * can retry inside one attempt, so clients compare it with their own
   * submit or capture time. Hidden from other viewers ({@link invoiceForViewer}).
   */
  last_payment_attempt_at: string | null;
  last_payment_failed_at: string | null;
  /** Stripe's member-facing decline message, when it sent one. */
  last_payment_failure_reason: string | null;
  created_at: string;
}

/**
 * The invoice as a given viewer may see it (#3460). The payment-attempt
 * fields are the payer's own: a card decline is the payer's business
 * (`spec/behavior/billing.md` § Member payment flow), so an officer reading
 * another member's invoice gets them as null.
 */
export function invoiceForViewer(
  invoice: FinancialInvoice,
  viewerId: string,
): FinancialInvoice {
  if (
    invoice.user_id === viewerId ||
    (invoice.last_payment_attempt_at == null &&
      invoice.last_payment_failed_at == null &&
      invoice.last_payment_failure_reason == null)
  ) {
    return invoice;
  }
  return {
    ...invoice,
    last_payment_attempt_at: null,
    last_payment_failed_at: null,
    last_payment_failure_reason: null,
  };
}
