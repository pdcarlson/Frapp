import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, desc } from 'drizzle-orm';
import * as schema from '../schema';
import { DRIZZLE_DB } from '../drizzle.provider';
import { IFinancialRepository } from '../../../domain/repositories/financial.repository.interface';
import { FinancialInvoice, FinancialTransaction } from '../../../domain/entities/financial.entity';

@Injectable()
export class DrizzleFinancialRepository implements IFinancialRepository {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async createInvoice(invoice: Omit<FinancialInvoice, 'id' | 'createdAt'>): Promise<FinancialInvoice> {
    const [result] = await this.db
      .insert(schema.financialInvoices)
      .values({
        chapterId: invoice.chapterId,
        userId: invoice.userId,
        title: invoice.title,
        description: invoice.description,
        amount: invoice.amount,
        status: invoice.status,
        dueDate: invoice.dueDate,
        paidAt: invoice.paidAt,
        stripePaymentIntentId: invoice.stripePaymentIntentId,
      })
      .returning();

    return this.mapInvoice(result);
  }

  async updateInvoice(id: string, updates: Partial<FinancialInvoice>): Promise<FinancialInvoice> {
    const [result] = await this.db
      .update(schema.financialInvoices)
      .set({ ...updates })
      .where(eq(schema.financialInvoices.id, id))
      .returning();

    return this.mapInvoice(result);
  }

  async findInvoiceById(id: string): Promise<FinancialInvoice | null> {
    const [result] = await this.db
      .select()
      .from(schema.financialInvoices)
      .where(eq(schema.financialInvoices.id, id))
      .limit(1);

    return result ? this.mapInvoice(result) : null;
  }

  async findInvoicesByUser(userId: string): Promise<FinancialInvoice[]> {
    const results = await this.db
      .select()
      .from(schema.financialInvoices)
      .where(eq(schema.financialInvoices.userId, userId))
      .orderBy(desc(schema.financialInvoices.createdAt));

    return results.map(this.mapInvoice.bind(this));
  }

  async findInvoicesByChapter(chapterId: string): Promise<FinancialInvoice[]> {
    const results = await this.db
      .select()
      .from(schema.financialInvoices)
      .where(eq(schema.financialInvoices.chapterId, chapterId))
      .orderBy(desc(schema.financialInvoices.createdAt));

    return results.map(this.mapInvoice.bind(this));
  }

  async createTransaction(transaction: Omit<FinancialTransaction, 'id' | 'createdAt'>): Promise<FinancialTransaction> {
    const [result] = await this.db
      .insert(schema.financialTransactions)
      .values({
        chapterId: transaction.chapterId,
        invoiceId: transaction.invoiceId,
        amount: transaction.amount,
        type: transaction.type,
        stripeChargeId: transaction.stripeChargeId,
      })
      .returning();

    return this.mapTransaction(result);
  }

  async findTransactionsByInvoice(invoiceId: string): Promise<FinancialTransaction[]> {
    const results = await this.db
      .select()
      .from(schema.financialTransactions)
      .where(eq(schema.financialTransactions.invoiceId, invoiceId))
      .orderBy(desc(schema.financialTransactions.createdAt));

    return results.map(this.mapTransaction.bind(this));
  }

  private mapInvoice(row: typeof schema.financialInvoices.$inferSelect): FinancialInvoice {
    return new FinancialInvoice(
      row.id,
      row.chapterId,
      row.userId,
      row.title,
      row.description,
      row.amount,
      row.status as 'DRAFT' | 'OPEN' | 'PAID' | 'VOID',
      row.dueDate,
      row.paidAt,
      row.stripePaymentIntentId,
      row.createdAt,
    );
  }

  private mapTransaction(row: typeof schema.financialTransactions.$inferSelect): FinancialTransaction {
    return new FinancialTransaction(
      row.id,
      row.chapterId,
      row.invoiceId,
      row.amount,
      row.type as 'PAYMENT' | 'REFUND' | 'ADJUSTMENT',
      row.stripeChargeId,
      row.createdAt,
    );
  }
}
