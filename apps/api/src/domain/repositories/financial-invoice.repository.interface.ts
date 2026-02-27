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
}
