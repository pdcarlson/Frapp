import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FINANCIAL_INVOICE_REPOSITORY } from '../../domain/repositories/financial-invoice.repository.interface';
import type { IFinancialInvoiceRepository } from '../../domain/repositories/financial-invoice.repository.interface';
import { FINANCIAL_TRANSACTION_REPOSITORY } from '../../domain/repositories/financial-transaction.repository.interface';
import type { IFinancialTransactionRepository } from '../../domain/repositories/financial-transaction.repository.interface';
import {
  BILLING_PROVIDER,
  type IBillingProvider,
  type PaymentIntentResult,
} from '../../domain/adapters/billing.interface';
import type {
  FinancialInvoice,
  InvoiceStatus,
} from '../../domain/entities/financial-invoice.entity';
import { NotificationService } from './notification.service';

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

// A stored PaymentIntent in any of these states can still be confirmed by the
// member, so the pay endpoint returns it instead of minting a new one.
const REUSABLE_INTENT_STATUSES = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'processing',
]);

export interface InvoicePaymentIntent {
  client_secret: string | null;
  payment_intent_id: string;
}

export interface ApplyStripePaymentInput {
  invoiceId: string;
  chapterId: string;
  paymentIntentId: string;
  chargeId: string | null;
}

@Injectable()
export class FinancialInvoiceService {
  private readonly logger = new Logger(FinancialInvoiceService.name);

  constructor(
    @Inject(FINANCIAL_INVOICE_REPOSITORY)
    private readonly invoiceRepo: IFinancialInvoiceRepository,
    @Inject(FINANCIAL_TRANSACTION_REPOSITORY)
    private readonly transactionRepo: IFinancialTransactionRepository,
    @Inject(BILLING_PROVIDER)
    private readonly billingProvider: IBillingProvider,
    private readonly notificationService: NotificationService,
  ) {}

  async findById(id: string, chapterId: string): Promise<FinancialInvoice> {
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

  async findOverdue(chapterId: string): Promise<FinancialInvoice[]> {
    return this.invoiceRepo.findOverdue(chapterId);
  }

  async create(input: CreateInvoiceInput): Promise<FinancialInvoice> {
    if (input.amount <= 0) {
      throw new BadRequestException(
        'Amount must be a positive integer (cents)',
      );
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
      throw new BadRequestException(
        'Amount must be a positive integer (cents)',
      );
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

    if (invoice.status === 'DRAFT' && newStatus === 'OPEN') {
      try {
        await this.notificationService.notifyUser(invoice.user_id, chapterId, {
          title: 'New Invoice',
          body: `You have a new invoice: ${invoice.title}`,
          priority: 'NORMAL',
          category: 'billing',
          data: { target: { screen: 'billing' } },
        });
      } catch {}
    }

    return updated;
  }

  /**
   * Member-initiated payment: create (or reuse) a Stripe PaymentIntent for the
   * caller's own OPEN invoice and return the client secret for confirmation.
   * The invoice is marked PAID only by the payment_intent.succeeded webhook —
   * never here.
   */
  async createPaymentIntent(
    invoiceId: string,
    chapterId: string,
    userId: string,
  ): Promise<InvoicePaymentIntent> {
    const invoice = await this.findById(invoiceId, chapterId);

    if (invoice.user_id !== userId) {
      throw new ForbiddenException('You can only pay your own invoices');
    }
    if (invoice.status !== 'OPEN') {
      throw new BadRequestException(
        `Only OPEN invoices can be paid (current status: ${invoice.status})`,
      );
    }

    let intent: PaymentIntentResult | null = null;
    try {
      if (invoice.stripe_payment_intent_id) {
        const existing = await this.billingProvider.getPaymentIntent(
          invoice.stripe_payment_intent_id,
        );
        if (existing.status === 'succeeded') {
          // Money already moved; the webhook will (or did) flip the invoice.
          throw new ConflictException(
            'Payment already completed; confirmation is being processed',
          );
        }
        if (REUSABLE_INTENT_STATUSES.has(existing.status)) {
          intent = existing;
        }
        // canceled (or any other terminal state) falls through to a fresh
        // intent that overwrites the stored id.
      }

      if (!intent) {
        intent = await this.billingProvider.createPaymentIntent({
          amount: invoice.amount,
          currency: 'usd',
          metadata: {
            invoice_id: invoice.id,
            chapter_id: chapterId,
            user_id: invoice.user_id,
          },
        });
      }
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      this.logger.error(
        `Stripe PaymentIntent request failed for invoice ${invoiceId}: ${error instanceof Error ? error.message : error}`,
      );
      throw new ServiceUnavailableException(
        'Payment provider is unavailable. Please try again.',
      );
    }

    if (intent.id !== invoice.stripe_payment_intent_id) {
      // Persist via the repo directly: service-level update() is DRAFT-only by
      // design, and this write must land on an OPEN invoice.
      await this.invoiceRepo.update(invoiceId, chapterId, {
        stripe_payment_intent_id: intent.id,
      });
    }

    return {
      client_secret: intent.clientSecret,
      payment_intent_id: intent.id,
    };
  }

  /**
   * Webhook-confirmed payment. Delegates to the apply_invoice_payment RPC,
   * which compare-and-sets OPEN → PAID and inserts the ledger row (with the
   * Stripe charge id) in one transaction — so duplicate deliveries and races
   * with a manual admin PAID transition are idempotent no-ops here.
   */
  async applyStripePaymentSuccess(
    input: ApplyStripePaymentInput,
  ): Promise<void> {
    const { invoiceId, chapterId, paymentIntentId, chargeId } = input;

    const paid = await this.invoiceRepo.applyPayment(
      invoiceId,
      chapterId,
      paymentIntentId,
      chargeId,
    );

    if (!paid) {
      // Missing, already PAID, or VOID. VOID is the loud case: the member
      // completed a payment for an invoice an admin voided — real money with
      // no ledger row, needs manual reconciliation.
      const current = await this.invoiceRepo.findById(invoiceId, chapterId);
      if (current?.status === 'VOID') {
        this.logger.warn(
          `payment_intent.succeeded for VOID invoice ${invoiceId} (chapter ${chapterId}, intent ${paymentIntentId}, charge ${chargeId ?? 'unknown'}) — payment captured with no ledger row; reconcile manually`,
        );
      } else {
        this.logger.log(
          `payment_intent.succeeded for invoice ${invoiceId} skipped (status: ${current?.status ?? 'missing'}) — duplicate delivery or already settled`,
        );
      }
      return;
    }

    try {
      await this.notificationService.notifyUser(paid.user_id, chapterId, {
        title: 'Payment received',
        body: `Your payment for "${paid.title}" was received.`,
        priority: 'NORMAL',
        category: 'billing',
        data: { target: { screen: 'billing' } },
      });
    } catch {}
  }

  async getTransactions(chapterId: string) {
    return this.transactionRepo.findByChapter(chapterId);
  }

  async getInvoiceTransactions(invoiceId: string, chapterId: string) {
    await this.findById(invoiceId, chapterId);
    return this.transactionRepo.findByInvoice(invoiceId);
  }
}
