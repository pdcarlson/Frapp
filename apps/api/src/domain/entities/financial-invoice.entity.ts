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
   * invoice means the member's latest attempt didn't go through.
   */
  last_payment_attempt_at: string | null;
  last_payment_failed_at: string | null;
  /** Stripe's member-facing decline message, when it sent one. */
  last_payment_failure_reason: string | null;
  created_at: string;
}
