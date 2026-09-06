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
import { FINANCIAL_INVOICE_REPOSITORY } from '#domain/repositories/financial-invoice.repository.interface';
import type { IFinancialInvoiceRepository } from '#domain/repositories/financial-invoice.repository.interface';
import { FINANCIAL_TRANSACTION_REPOSITORY } from '#domain/repositories/financial-transaction.repository.interface';
import type { IFinancialTransactionRepository } from '#domain/repositories/financial-transaction.repository.interface';
import {
  BILLING_PROVIDER,
  type IBillingProvider,
  type PaymentIntentResult,
} from '#domain/adapters/billing.interface';
import type {
  FinancialInvoice,
  InvoiceStatus,
} from '#domain/entities/financial-invoice.entity';
import { NotificationService } from './notification.service';
import { ChapterWorkflowsService } from './chapter-workflows.service';

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

/**
 * Stripe answers a same-key request that is still in flight with an
 * idempotency conflict. Matched structurally so the domain layer stays free of
 * the Stripe SDK (per the billing adapter rule in spec/behavior/billing.md).
 */
function isIdempotencyConflict(error: unknown): boolean {
  // The Stripe SDK sets `type` to the error class name and `rawType` to the
  // wire value, so match both rather than depending on which one a given
  // version surfaces.
  const { type, rawType } =
    (error as { type?: unknown; rawType?: unknown } | null) ?? {};
  return [type, rawType].some(
    (t) => t === 'idempotency_error' || t === 'StripeIdempotencyError',
  );
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
    private readonly chapterWorkflows: ChapterWorkflowsService,
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
    // Chapter policy (Settings → Workflows): wf_dues_grace shifts when an
    // OPEN invoice counts as overdue (0 days when the toggle is off).
    const graceDays = await this.chapterWorkflows.getDuesGraceDays(chapterId);
    return this.invoiceRepo.findOverdue(chapterId, graceDays);
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

    let updated: FinancialInvoice;
    if (newStatus === 'PAID') {
      // Same atomic CAS the webhook uses (nulls: no intent/charge to record —
      // the RPC preserves any stored intent id). If the webhook wins the race
      // first, this returns null instead of double-writing the ledger.
      const paid = await this.invoiceRepo.applyPayment(
        id,
        chapterId,
        null,
        null,
      );
      if (!paid) {
        throw new BadRequestException(
          'Invoice is no longer OPEN — it was paid or voided concurrently',
        );
      }
      updated = paid;
    } else {
      updated = await this.invoiceRepo.update(id, chapterId, {
        status: newStatus,
      });
    }

    if (
      (newStatus === 'VOID' || newStatus === 'PAID') &&
      invoice.stripe_payment_intent_id
    ) {
      // Both terminal states must kill any outstanding client secret: a
      // payment sheet the member already opened otherwise stays confirmable
      // and can capture real money against an invoice that is voided (no
      // ledger row) or already settled in cash (a double charge). Best-effort
      // — a terminal transition must not fail on Stripe.
      try {
        await this.billingProvider.cancelPaymentIntent(
          invoice.stripe_payment_intent_id,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to cancel PaymentIntent ${invoice.stripe_payment_intent_id} while moving invoice ${id} to ${newStatus}: ${error instanceof Error ? error.message : error} — the intent may still be confirmable; verify in Stripe`,
        );
      }
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
        // Null = the id no longer exists at the provider (key/account
        // migration) — fall through and mint a fresh intent.
        const existing = await this.billingProvider.getPaymentIntent(
          invoice.stripe_payment_intent_id,
        );
        if (existing?.status === 'succeeded') {
          // Money already moved; the webhook will (or did) flip the invoice.
          throw new ConflictException(
            'Payment already completed; confirmation is being processed',
          );
        }
        if (existing && REUSABLE_INTENT_STATUSES.has(existing.status)) {
          intent = existing;
        }
        // canceled/unknown (or any other terminal state) falls through to a
        // fresh intent that overwrites the stored id.
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
          // Keyed on the stored id so two concurrent first attempts collapse
          // into ONE provider-side intent (both callers get the same one back)
          // instead of minting two separately chargeable intents. A re-mint
          // after canceled/unknown has a different stored id → different key.
          idempotencyKey: `invoice-pay-${invoice.id}-${invoice.stripe_payment_intent_id ?? 'first'}`,
        });
      }
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      // A concurrent request holding the same idempotency key is still in
      // flight at the provider — that's the double-tap this key exists to
      // collapse, not an outage. Tell the caller to retry, and don't page
      // on-call with an ERROR log.
      if (isIdempotencyConflict(error)) {
        this.logger.log(
          `Concurrent PaymentIntent request for invoice ${invoiceId}; another attempt is in flight`,
        );
        throw new ConflictException(
          'A payment attempt for this invoice is already in progress. Please retry in a moment.',
        );
      }
      this.logger.error(
        `Stripe PaymentIntent request failed for invoice ${invoiceId}: ${error instanceof Error ? error.message : error}`,
      );
      throw new ServiceUnavailableException(
        'Payment provider is unavailable. Please try again.',
      );
    }

    // Re-validate that the invoice is STILL open before handing out a client
    // secret. The check at the top of this method is stale — Stripe
    // round-trips sit in between, and an invoice can settle (cash) or be
    // voided in that window. This runs on the reuse path too: reusing an
    // existing intent hands out a live secret just the same.
    const stamped = await this.invoiceRepo.setPaymentIntentIfOpen(
      invoiceId,
      chapterId,
      intent.id,
    );
    if (!stamped) {
      const current = await this.invoiceRepo.findById(invoiceId, chapterId);
      if (current?.status === 'PAID') {
        throw new ConflictException(
          'Invoice was already paid; no further payment is needed',
        );
      }
      throw new BadRequestException(
        `Only OPEN invoices can be paid (current status: ${current?.status ?? 'missing'})`,
      );
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
      // Missing, already PAID, or VOID. Every payment_intent.succeeded means
      // money actually moved, so a miss is benign ONLY if this charge already
      // has its ledger row (a true redelivery). Anything else — VOID invoice,
      // second intent on a PAID invoice, cash-marked PAID racing a card
      // payment — is a captured charge with no ledger row: warn loudly for
      // manual reconciliation (refund or reissue).
      const current = await this.invoiceRepo.findById(invoiceId, chapterId);
      // Only a charge id can prove a redelivery: a manual PAID writes a
      // null-charge ledger row and the RPC preserves the stored intent id, so
      // "PAID by this intent" looks identical to a cash entry that raced a
      // real card capture. Without a charge id we cannot tell them apart and
      // must not stay silent about money.
      const ledgered = chargeId
        ? (await this.transactionRepo.findByInvoice(invoiceId)).some(
            (t) => t.stripe_charge_id === chargeId,
          )
        : false;
      if (ledgered) {
        this.logger.log(
          `payment_intent.succeeded for invoice ${invoiceId} skipped — duplicate delivery of already-ledgered charge ${chargeId}`,
        );
      } else if (chargeId === null) {
        this.logger.warn(
          `payment_intent.succeeded for ${current?.status ?? 'missing'} invoice ${invoiceId} (chapter ${chapterId}, intent ${paymentIntentId}) carried no charge id, so it cannot be matched to the ledger — this is either a redelivery or an unrecorded capture; verify in Stripe. Pinning a Stripe API version that sends latest_charge removes this ambiguity.`,
        );
      } else {
        this.logger.warn(
          `payment_intent.succeeded for ${current?.status ?? 'missing'} invoice ${invoiceId} (chapter ${chapterId}, intent ${paymentIntentId}, charge ${chargeId ?? 'unknown'}, stored intent ${current?.stripe_payment_intent_id ?? 'none'}) — captured payment with no ledger row; reconcile manually`,
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

  async getInvoiceTransactions(invoiceId: string, chapterId: string) {
    await this.findById(invoiceId, chapterId);
    return this.transactionRepo.findByInvoice(invoiceId);
  }
}
