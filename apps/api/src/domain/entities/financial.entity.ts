export class FinancialInvoice {
  constructor(
    public readonly id: string,
    public readonly chapterId: string,
    public readonly userId: string,
    public readonly title: string,
    public readonly description: string | null,
    public readonly amount: number,
    public readonly status: 'DRAFT' | 'OPEN' | 'PAID' | 'VOID',
    public readonly dueDate: Date,
    public readonly paidAt: Date | null,
    public readonly stripePaymentIntentId: string | null,
    public readonly createdAt: Date,
  ) {}
}

export class FinancialTransaction {
  constructor(
    public readonly id: string,
    public readonly chapterId: string,
    public readonly invoiceId: string | null,
    public readonly amount: number,
    public readonly type: 'PAYMENT' | 'REFUND' | 'ADJUSTMENT',
    public readonly stripeChargeId: string | null,
    public readonly createdAt: Date,
  ) {}
}
