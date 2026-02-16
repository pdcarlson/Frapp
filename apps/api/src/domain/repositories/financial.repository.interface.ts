import {
  FinancialInvoice,
  FinancialTransaction,
} from '../entities/financial.entity';

export const FINANCIAL_REPOSITORY = 'FINANCIAL_REPOSITORY';

export interface IFinancialRepository {
  // Invoices
  createInvoice(
    invoice: Omit<FinancialInvoice, 'id' | 'createdAt'>,
  ): Promise<FinancialInvoice>;
  updateInvoice(
    id: string,
    updates: Partial<FinancialInvoice>,
  ): Promise<FinancialInvoice>;
  findInvoiceById(id: string): Promise<FinancialInvoice | null>;
  findInvoicesByUser(userId: string): Promise<FinancialInvoice[]>;
  findInvoicesByChapter(chapterId: string): Promise<FinancialInvoice[]>;

  // Transactions
  createTransaction(
    transaction: Omit<FinancialTransaction, 'id' | 'createdAt'>,
  ): Promise<FinancialTransaction>;
  findTransactionsByInvoice(invoiceId: string): Promise<FinancialTransaction[]>;
}
