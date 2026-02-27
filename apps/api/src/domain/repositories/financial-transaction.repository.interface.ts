import { FinancialTransaction } from '../entities/financial-transaction.entity';

export const FINANCIAL_TRANSACTION_REPOSITORY =
  'FINANCIAL_TRANSACTION_REPOSITORY';

export interface IFinancialTransactionRepository {
  findByChapter(chapterId: string): Promise<FinancialTransaction[]>;
  findByInvoice(invoiceId: string): Promise<FinancialTransaction[]>;
  create(data: Partial<FinancialTransaction>): Promise<FinancialTransaction>;
}
