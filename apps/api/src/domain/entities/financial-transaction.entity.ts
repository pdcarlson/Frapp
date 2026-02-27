export type FinancialTransactionType = 'PAYMENT' | 'REFUND' | 'ADJUSTMENT';

export interface FinancialTransaction {
  id: string;
  chapter_id: string;
  invoice_id: string | null;
  amount: number;
  type: FinancialTransactionType;
  stripe_charge_id: string | null;
  created_at: string;
}
