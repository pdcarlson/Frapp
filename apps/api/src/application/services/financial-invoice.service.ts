import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { FINANCIAL_INVOICE_REPOSITORY } from '../../domain/repositories/financial-invoice.repository.interface';
import type { IFinancialInvoiceRepository } from '../../domain/repositories/financial-invoice.repository.interface';
import { FINANCIAL_TRANSACTION_REPOSITORY } from '../../domain/repositories/financial-transaction.repository.interface';
import type { IFinancialTransactionRepository } from '../../domain/repositories/financial-transaction.repository.interface';
import type {
  FinancialInvoice,
  InvoiceStatus,
} from '../../domain/entities/financial-invoice.entity';

export interface CreateInvoiceInput {
  chapter_id: string;
  user_id: string;
  title: string;
  description?: string | null;
  amount: number;
  due_date: string;
}

export interface UpdateInvoiceInput {
  title?: string;
  description?: string | null;
  amount?: number;
  due_date?: string;
}

const VALID_STATUS_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ['OPEN', 'VOID'],
  OPEN: ['PAID', 'VOID'],
  PAID: [],
  VOID: [],
};

@Injectable()
export class FinancialInvoiceService {
  constructor(
    @Inject(FINANCIAL_INVOICE_REPOSITORY)
    private readonly invoiceRepo: IFinancialInvoiceRepository,
    @Inject(FINANCIAL_TRANSACTION_REPOSITORY)
    private readonly transactionRepo: IFinancialTransactionRepository,
  ) {}

  async findById(
    id: string,
    chapterId: string,
  ): Promise<FinancialInvoice> {
    const invoice = await this.invoiceRepo.findById(id, chapterId);
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  async findByChapter(chapterId: string): Promise<FinancialInvoice[]> {
    return this.invoiceRepo.findByChapter(chapterId);
  }

  async findByUser(
    userId: string,
    chapterId: string,
  ): Promise<FinancialInvoice[]> {
    return this.invoiceRepo.findByUser(userId, chapterId);
  }

  async create(input: CreateInvoiceInput): Promise<FinancialInvoice> {
    if (input.amount <= 0) {
      throw new BadRequestException('Amount must be a positive integer (cents)');
    }

    const dueDate = new Date(input.due_date);
    if (Number.isNaN(dueDate.getTime())) {
      throw new BadRequestException('due_date must be a valid date');
    }

    return this.invoiceRepo.create({
      chapter_id: input.chapter_id,
      user_id: input.user_id,
      title: input.title,
      description: input.description ?? null,
      amount: input.amount,
      status: 'DRAFT',
      due_date: input.due_date,
    });
  }

  async update(
    id: string,
    chapterId: string,
    input: UpdateInvoiceInput,
  ): Promise<FinancialInvoice> {
    const invoice = await this.findById(id, chapterId);

    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException(
        'Only DRAFT invoices can be edited. Void the invoice and create a new one instead.',
      );
    }

    if (input.amount !== undefined && input.amount <= 0) {
      throw new BadRequestException('Amount must be a positive integer (cents)');
    }

    if (input.due_date !== undefined) {
      const dueDate = new Date(input.due_date);
      if (Number.isNaN(dueDate.getTime())) {
        throw new BadRequestException('due_date must be a valid date');
      }
    }

    return this.invoiceRepo.update(id, chapterId, input);
  }

  async transitionStatus(
    id: string,
    chapterId: string,
    newStatus: InvoiceStatus,
  ): Promise<FinancialInvoice> {
    const invoice = await this.findById(id, chapterId);

    const allowedTransitions = VALID_STATUS_TRANSITIONS[invoice.status];
    if (!allowedTransitions.includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition from ${invoice.status} to ${newStatus}. Allowed: ${allowedTransitions.join(', ') || 'none'}`,
      );
    }

    const updateData: Partial<FinancialInvoice> = { status: newStatus };

    if (newStatus === 'PAID') {
      updateData.paid_at = new Date().toISOString();
    }

    const updated = await this.invoiceRepo.update(id, chapterId, updateData);

    if (newStatus === 'PAID') {
      await this.transactionRepo.create({
        chapter_id: chapterId,
        invoice_id: id,
        amount: invoice.amount,
        type: 'PAYMENT',
      });
    }

    return updated;
  }

  async getTransactions(chapterId: string) {
    return this.transactionRepo.findByChapter(chapterId);
  }

  async getInvoiceTransactions(invoiceId: string) {
    return this.transactionRepo.findByInvoice(invoiceId);
  }
}
