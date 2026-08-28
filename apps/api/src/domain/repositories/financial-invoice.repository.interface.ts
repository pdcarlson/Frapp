import { FinancialInvoice } from '../entities/financial-invoice.entity';

export const FINANCIAL_INVOICE_REPOSITORY = 'FINANCIAL_INVOICE_REPOSITORY';

export interface IFinancialInvoiceRepository {
  findById(id: string, chapterId: string): Promise<FinancialInvoice | null>;
  findByChapter(chapterId: string): Promise<FinancialInvoice[]>;
  findByUser(userId: string, chapterId: string): Promise<FinancialInvoice[]>;
  /**
   * OPEN invoices past due_date plus the chapter's dues grace period.
   * `graceDays` 0 means an invoice is overdue the day after `due_date`.
   */
  findOverdue(
    chapterId: string,
    graceDays?: number,
  ): Promise<FinancialInvoice[]>;
  create(data: Partial<FinancialInvoice>): Promise<FinancialInvoice>;
  update(
    id: string,
    chapterId: string,
    data: Partial<FinancialInvoice>,
  ): Promise<FinancialInvoice>;
  /**
   * Atomically move an OPEN invoice to PAID and insert its PAYMENT ledger row
   * in one transaction. Both PAID writers use this: the webhook passes the
   * intent + charge ids; the admin manual transition passes nulls (a stored
   * intent id is preserved). Returns null when the invoice is missing, already
   * PAID, or VOID — the caller decides whether that is a benign no-op.
   */
  applyPayment(
    id: string,
    chapterId: string,
    paymentIntentId: string | null,
    chargeId: string | null,
  ): Promise<FinancialInvoice | null>;
  /**
   * Stamp a PaymentIntent id onto an invoice only while it is still OPEN.
   * Returns null (without writing) when the invoice changed state underneath
   * the caller — the pay flow must then re-read and refuse, never hand out a
   * client secret for a settled or voided invoice.
   */
  setPaymentIntentIfOpen(
    id: string,
    chapterId: string,
    paymentIntentId: string,
  ): Promise<FinancialInvoice | null>;
}
