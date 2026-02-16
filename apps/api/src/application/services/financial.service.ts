import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { FINANCIAL_REPOSITORY } from '../../domain/repositories/financial.repository.interface';
import type { IFinancialRepository } from '../../domain/repositories/financial.repository.interface';
import { BILLING_PROVIDER } from '../../domain/adapters/billing.interface';
import type { IBillingProvider } from '../../domain/adapters/billing.interface';
import { FinancialInvoice } from '../../domain/entities/financial.entity';

@Injectable()
export class FinancialService {
  private readonly logger = new Logger(FinancialService.name);

  constructor(
    @Inject(FINANCIAL_REPOSITORY)
    private readonly financialRepo: IFinancialRepository,
    @Inject(BILLING_PROVIDER)
    private readonly billingProvider: IBillingProvider,
  ) {}

  async createInvoice(data: {
    userId: string;
    chapterId: string;
    title: string;
    description: string | null;
    amount: number;
    dueDate: Date;
  }): Promise<FinancialInvoice> {
    return this.financialRepo.createInvoice({
      ...data,
      status: 'OPEN',
      paidAt: null,
      stripePaymentIntentId: null,
    });
  }

  async generatePaymentLink(
    invoiceId: string,
    stripeCustomerId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<string> {
    const invoice = await this.financialRepo.findInvoiceById(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== 'OPEN')
      throw new BadRequestException('Invoice is not open for payment');

    return this.billingProvider.createInvoiceCheckout(
      stripeCustomerId,
      invoice.amount,
      invoice.title,
      successUrl,
      cancelUrl,
      { invoiceId: invoice.id },
    );
  }

  async processPayment(
    invoiceId: string,
    stripePaymentIntentId: string,
  ): Promise<void> {
    const invoice = await this.financialRepo.findInvoiceById(invoiceId);
    if (!invoice) {
      this.logger.error(`Received payment for unknown invoice ${invoiceId}`);
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.status === 'PAID') {
      this.logger.log(`Invoice ${invoiceId} already paid. Skipping.`);
      return;
    }

    // Atomic update ideally, but sequential for now
    await this.financialRepo.updateInvoice(invoiceId, {
      status: 'PAID',
      paidAt: new Date(),
      stripePaymentIntentId,
    });

    await this.financialRepo.createTransaction({
      chapterId: invoice.chapterId,
      invoiceId: invoice.id,
      amount: invoice.amount,
      type: 'PAYMENT',
      stripeChargeId: stripePaymentIntentId, // Using PI as charge ID ref for simplicity
    });

    this.logger.log(`Invoice ${invoiceId} marked as PAID`);
  }

  async getUserInvoices(userId: string): Promise<FinancialInvoice[]> {
    return this.financialRepo.findInvoicesByUser(userId);
  }
}
