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
  created_at: string;
}
