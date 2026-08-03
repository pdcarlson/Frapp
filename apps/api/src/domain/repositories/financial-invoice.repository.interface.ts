import { FinancialInvoice } from '../entities/financial-invoice.entity';

export const FINANCIAL_INVOICE_REPOSITORY = 'FINANCIAL_INVOICE_REPOSITORY';

export interface IFinancialInvoiceRepository {
  findById(id: string, chapterId: string): Promise<FinancialInvoice | null>;
  findByChapter(chapterId: string): Promise<FinancialInvoice[]>;
  findByUser(userId: string, chapterId: string): Promise<FinancialInvoice[]>;
  findOverdue(chapterId: string): Promise<FinancialInvoice[]>;
  create(data: Partial<FinancialInvoice>): Promise<FinancialInvoice>;
  update(
    id: string,
    chapterId: string,
    data: Partial<FinancialInvoice>,
  ): Promise<FinancialInvoice>;
  /**
   * Atomically move an OPEN invoice to PAID and insert its PAYMENT ledger row
   * (with the Stripe charge id) in one transaction. Returns null when the
   * invoice is missing, already PAID, or VOID — the caller treats that as an
   * idempotent no-op.
   */
  applyPayment(
    id: string,
    chapterId: string,
    paymentIntentId: string,
    chargeId: string | null,
  ): Promise<FinancialInvoice | null>;
}
