import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  BILLING_PROVIDER,
  chargeIdFromLatestCharge,
  type IBillingProvider,
  type WebhookEvent,
  type CheckoutSessionWebhookObject,
  type SubscriptionWebhookObject,
  type InvoiceWebhookObject,
  type PaymentIntentWebhookObject,
} from '../../domain/adapters/billing.interface';
import { FinancialInvoiceService } from './financial-invoice.service';
import { CHAPTER_REPOSITORY } from '../../domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '../../domain/repositories/chapter.repository.interface';
import type {
  Chapter,
  SubscriptionStatus,
} from '../../domain/entities/chapter.entity';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import type { IRoleRepository } from '../../domain/repositories/role.repository.interface';
import { STRIPE_WEBHOOK_EVENT_REPOSITORY } from '../../domain/repositories/stripe-webhook-event.repository.interface';
import type { IStripeWebhookEventRepository } from '../../domain/repositories/stripe-webhook-event.repository.interface';
import { SystemRoleKeys } from '../../domain/constants/permissions';
import { NotificationService } from './notification.service';

export interface CreateCheckoutInput {
  chapterId: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CreatePortalInput {
  chapterId: string;
  returnUrl: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The event types with side effects, and therefore the only ones worth
 * deduplicating (FRA-23). Anything else is logged and dropped before the
 * database is touched, so a shared Stripe account's unrelated traffic does not
 * accumulate claim rows. Keep in sync with the switch in `handleWebhookEvent`.
 */
const HANDLED_WEBHOOK_EVENT_TYPES: ReadonlySet<string> = new Set([
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'payment_intent.succeeded',
]);

/**
 * How long a claim may sit in `processing` before another delivery may take it
 * over. Only reached when a worker died mid-handler; a healthy handler
 * finishes in well under a second. Stripe's own retry cadence starts at
 * minutes, so this never races a normal redelivery.
 */
const WEBHOOK_CLAIM_STALE_SECONDS = 300;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(BILLING_PROVIDER)
    private readonly billingProvider: IBillingProvider,
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapterRepo: IChapterRepository,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
    @Inject(ROLE_REPOSITORY)
    private readonly roleRepo: IRoleRepository,
    @Inject(STRIPE_WEBHOOK_EVENT_REPOSITORY)
    private readonly webhookEventRepo: IStripeWebhookEventRepository,
    private readonly notificationService: NotificationService,
    private readonly financialInvoiceService: FinancialInvoiceService,
  ) {}

  async getChapterBillingStatus(chapterId: string) {
    const chapter = await this.chapterRepo.findById(chapterId);
    if (!chapter) {
      throw new NotFoundException('Chapter not found');
    }

    return {
      subscription_status: chapter.subscription_status,
      stripe_customer_id: chapter.stripe_customer_id,
      subscription_id: chapter.subscription_id,
    };
  }

  async createCheckoutSession(input: CreateCheckoutInput): Promise<string> {
    const chapter = await this.chapterRepo.findById(input.chapterId);
    if (!chapter) {
      throw new NotFoundException('Chapter not found');
    }

    if (chapter.subscription_status === 'active') {
      throw new BadRequestException(
        'Chapter already has an active subscription',
      );
    }

    try {
      if (!chapter.stripe_customer_id) {
        const customerId = await this.billingProvider.createCustomer(
          input.customerEmail,
          chapter.name,
        );
        await this.chapterRepo.update(chapter.id, {
          stripe_customer_id: customerId,
        });
      }

      return await this.billingProvider.createCheckoutSession({
        chapterId: input.chapterId,
        customerEmail: input.customerEmail,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
      });
    } catch (error) {
      this.logger.error(
        `Failed to create checkout session for chapter ${input.chapterId}`,
        error instanceof Error ? error.stack : error,
      );
      throw new ServiceUnavailableException(
        'Billing service is temporarily unavailable',
      );
    }
  }

  async createPortalSession(input: CreatePortalInput): Promise<string> {
    const chapter = await this.chapterRepo.findById(input.chapterId);
    if (!chapter) {
      throw new NotFoundException('Chapter not found');
    }

    if (!chapter.stripe_customer_id) {
      throw new BadRequestException(
        'Chapter has no billing account. Complete checkout first.',
      );
    }

    try {
      return await this.billingProvider.createCustomerPortalSession({
        customerId: chapter.stripe_customer_id,
        returnUrl: input.returnUrl,
      });
    } catch (error) {
      this.logger.error(
        `Failed to create portal session for chapter ${input.chapterId}`,
        error instanceof Error ? error.stack : error,
      );
      throw new ServiceUnavailableException(
        'Billing service is temporarily unavailable',
      );
    }
  }

  /**
   * Idempotency is durable (FRA-23): the event id is claimed in
   * `stripe_webhook_events` *before* any side effect runs, so a redelivery
   * after a deploy, crash, or onto a second instance is skipped rather than
   * re-applied. This is deliberately at-least-once — a claim that survives its
   * handler's crash is retried after the stale lease rather than dropped,
   * because losing a billing event is worse than re-applying one.
   *
   * Distinct from FRA-242's `last_stripe_webhook_at` ordering mark, which
   * treats a same-second redelivery as fresh and so cannot dedup on its own.
   */
  async handleWebhookEvent(event: WebhookEvent): Promise<void> {
    if (!HANDLED_WEBHOOK_EVENT_TYPES.has(event.type)) {
      this.logger.debug(`Unhandled webhook event type: ${event.type}`);
      return;
    }

    const claim = await this.webhookEventRepo.claim(
      event.id,
      event.type,
      WEBHOOK_CLAIM_STALE_SECONDS,
    );

    if (claim.outcome === 'already_processed') {
      this.logger.debug(`Skipping already-processed event ${event.id}`);
      return;
    }

    if (claim.outcome === 'in_flight') {
      // Another instance is mid-handler. Deliberately 503 rather than ack:
      // acking would tell Stripe the event is delivered while its outcome is
      // still unknown, and if that worker then fails, nothing would ever retry
      // it — a silently dropped billing event, which is exactly what the
      // at-least-once posture above exists to prevent. Stripe's retry finds
      // either `already_processed` (acked) or a failed/stale claim (re-taken).
      this.logger.warn(
        `Deferring ${event.type} ${event.id}: another worker holds the claim`,
      );
      throw new ServiceUnavailableException(
        'Webhook event is already being processed; retry shortly',
      );
    }

    this.logger.log(
      `Processing webhook event: ${event.type} (${event.id}), attempt ${claim.attempts}`,
    );

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutCompleted(event);
          break;
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event);
          break;
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event);
          break;
        case 'invoice.paid':
          await this.handleInvoicePaid(event);
          break;
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(event);
          break;
        default:
          // Unreachable while the switch and HANDLED_WEBHOOK_EVENT_TYPES agree.
          this.logger.error(
            `Claimed ${event.id} but no handler for type ${event.type} — ` +
              'HANDLED_WEBHOOK_EVENT_TYPES is out of sync with the switch',
          );
      }
    } catch (error) {
      await this.releaseFailedClaim(event, error);
      // Rethrow so the controller 5xxs and Stripe retries, as before.
      throw error;
    }

    await this.webhookEventRepo.markProcessed(event.id);
  }

  /**
   * Record the failure and leave the event immediately re-claimable (AC-4).
   * Never masks the handler's error: a bookkeeping failure here is logged, and
   * the row simply stays `processing` until its lease expires.
   */
  private async releaseFailedClaim(
    event: WebhookEvent,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await this.webhookEventRepo.markFailed(event.id, message);
    } catch (markError) {
      this.logger.error(
        `Failed to record webhook failure for ${event.id}; the claim will be ` +
          `retried after its lease expires: ${
            markError instanceof Error ? markError.message : String(markError)
          }`,
      );
    }
  }

  private async handleCheckoutCompleted(event: WebhookEvent): Promise<void> {
    const session = event.data.object as CheckoutSessionWebhookObject;
    const chapterId = session.metadata?.chapter_id;
    const subscriptionId = session.subscription;

    if (!chapterId) {
      this.logger.warn(
        `checkout.session.completed missing chapter_id in metadata: ${event.id}`,
      );
      return;
    }

    // Same guard as the payment-intent path: a foreign integration's non-UUID
    // metadata would otherwise reach a uuid-typed column and 500, which Stripe
    // retries for days.
    if (!UUID_PATTERN.test(chapterId)) {
      this.logger.warn(
        `checkout.session.completed with non-UUID chapter_id (${chapterId}): ${event.id} — ignoring foreign session`,
      );
      return;
    }

    const chapter = await this.chapterRepo.findById(chapterId);
    if (!chapter) {
      this.logger.warn(
        `checkout.session.completed for non-existent chapter: ${chapterId}`,
      );
      return;
    }

    // FRA-242: ignore a redelivered/late checkout that predates a newer event
    // (e.g. Stripe retries an old checkout after the API restart cleared the
    // in-memory idempotency set, when the subscription has since moved on).
    if (this.isStaleWebhook(chapter, event, 'checkout.session.completed')) {
      return;
    }

    await this.chapterRepo.update(chapterId, {
      subscription_status: 'active',
      subscription_id: subscriptionId ?? chapter.subscription_id,
      stripe_customer_id: session.customer ?? chapter.stripe_customer_id,
      last_stripe_webhook_at: this.eventCreatedAt(event),
    });

    this.logger.log(`Chapter ${chapterId} activated via checkout`);
  }

  private async handleSubscriptionUpdated(event: WebhookEvent): Promise<void> {
    const subscription = event.data.object as SubscriptionWebhookObject;
    if (!subscription.id) {
      this.logger.warn(
        `customer.subscription.updated missing subscription id: ${event.id}`,
      );
      return;
    }
    const chapter = await this.findChapterBySubscription(subscription.id);
    if (!chapter) return;

    if (!subscription.status) {
      this.logger.warn(
        `customer.subscription.updated missing subscription status: ${event.id}`,
      );
      return;
    }

    const newStatus = this.mapStripeStatus(subscription.status);
    if (!newStatus) {
      this.logger.warn(
        `Unknown Stripe subscription status: ${subscription.status}`,
      );
      return;
    }

    // FRA-242: an older/retried delivery must not overwrite a newer status.
    if (this.isStaleWebhook(chapter, event, 'customer.subscription.updated')) {
      return;
    }

    const statusChanged = newStatus !== chapter.subscription_status;

    // FRA-109: maintain the past_due grace clock. Start it only on the
    // into-past_due transition (idempotent across repeated past_due events);
    // clear it whenever the chapter leaves past_due. Anchor the timestamp to
    // the Stripe event creation time (Unix seconds), not processing time, so a
    // delayed/retried webhook delivery can't extend the 3-day grace window.
    const update: Partial<Chapter> = {
      subscription_status: newStatus,
      last_stripe_webhook_at: this.eventCreatedAt(event),
    };
    if (newStatus === 'past_due') {
      if (chapter.subscription_status !== 'past_due') {
        update.past_due_since = this.eventCreatedAt(event);
      }
    } else {
      update.past_due_since = null;
    }

    await this.chapterRepo.update(chapter.id, update);

    // AC #4: only notify the president when the status actually changes.
    if (statusChanged) {
      await this.notifyChapterPresident(chapter.id, newStatus);
    }

    this.logger.log(
      `Chapter ${chapter.id} subscription updated to ${newStatus}`,
    );
  }

  private async handleSubscriptionDeleted(event: WebhookEvent): Promise<void> {
    const subscription = event.data.object as SubscriptionWebhookObject;
    if (!subscription.id) {
      this.logger.warn(
        `customer.subscription.deleted missing subscription id: ${event.id}`,
      );
      return;
    }
    const chapter = await this.findChapterBySubscription(subscription.id);
    if (!chapter) return;

    // FRA-242: an older/retried delivery must not overwrite a newer status.
    if (this.isStaleWebhook(chapter, event, 'customer.subscription.deleted')) {
      return;
    }

    const wasCanceled = chapter.subscription_status === 'canceled';

    await this.chapterRepo.update(chapter.id, {
      subscription_status: 'canceled',
      past_due_since: null,
      last_stripe_webhook_at: this.eventCreatedAt(event),
    });

    // AC #4: only notify the president when the status actually changes.
    if (!wasCanceled) {
      await this.notifyChapterPresident(chapter.id, 'canceled');
    }

    this.logger.log(`Chapter ${chapter.id} subscription canceled`);
  }

  private async handleInvoicePaid(event: WebhookEvent): Promise<void> {
    const invoice = event.data.object as InvoiceWebhookObject;
    const subscriptionId = invoice.subscription;
    if (!subscriptionId) return;

    const chapter = await this.findChapterBySubscription(subscriptionId);
    if (!chapter) return;

    // FRA-242: a stale invoice payment must not reactivate a chapter whose
    // subscription has since moved to a newer past_due/canceled state.
    if (this.isStaleWebhook(chapter, event, 'invoice.paid')) {
      return;
    }

    // Advance the ordering mark on every non-stale payment — even a renewal that
    // doesn't change status — so a later out-of-order dunning event that
    // predates this payment can't downgrade the chapter (FRA-242).
    const update: Partial<Chapter> = {
      last_stripe_webhook_at: this.eventCreatedAt(event),
    };
    if (chapter.subscription_status === 'past_due') {
      update.subscription_status = 'active';
      update.past_due_since = null;
    }

    await this.chapterRepo.update(chapter.id, update);

    if (update.subscription_status === 'active') {
      // Reactivation via payment is expected and intentionally silent — president
      // status-change alerts are limited to the subscription updated/deleted paths.
      this.logger.log(`Chapter ${chapter.id} reactivated via invoice payment`);
    }
  }

  /**
   * Member dues payment confirmed (FRA-15). The PaymentIntent's metadata is
   * written only by our pay endpoint and arrives inside a signature-verified
   * event, so it is the authoritative invoice reference. Idempotency lives in
   * the apply_invoice_payment CAS, not the chapter-level staleness mark —
   * that mark orders *subscription* state and would misorder unrelated
   * member payments.
   */
  private async handlePaymentIntentSucceeded(
    event: WebhookEvent,
  ): Promise<void> {
    const intent = event.data.object as PaymentIntentWebhookObject;
    const invoiceId = intent.metadata?.invoice_id;
    const chapterId = intent.metadata?.chapter_id;

    if (!invoiceId || !chapterId) {
      // Not a member-invoice intent (e.g. a subscription checkout's intent).
      this.logger.debug(
        `payment_intent.succeeded without invoice metadata: ${event.id}`,
      );
      return;
    }

    // Other integrations on the same Stripe account can carry arbitrary
    // metadata; forwarding a non-UUID into the uuid-typed RPC params would
    // 22P02 → 500 → Stripe retries the event for days. Ack-and-log instead.
    if (!UUID_PATTERN.test(invoiceId) || !UUID_PATTERN.test(chapterId)) {
      this.logger.warn(
        `payment_intent.succeeded with non-UUID invoice metadata (invoice_id: ${invoiceId}, chapter_id: ${chapterId}): ${event.id} — ignoring foreign intent`,
      );
      return;
    }

    await this.financialInvoiceService.applyStripePaymentSuccess({
      invoiceId,
      chapterId,
      paymentIntentId: intent.id,
      chargeId: chargeIdFromLatestCharge(intent.latest_charge),
    });
  }

  private async findChapterBySubscription(
    subscriptionId: string,
  ): Promise<Chapter | null> {
    const chapter = await this.chapterRepo.findBySubscriptionId(subscriptionId);
    if (!chapter) {
      this.logger.warn(`No chapter found for subscription: ${subscriptionId}`);
    }
    return chapter;
  }

  private async notifyChapterPresident(
    chapterId: string,
    newStatus: string,
  ): Promise<void> {
    try {
      const presidentRole = await this.roleRepo.findByChapterAndSystemKey(
        chapterId,
        SystemRoleKeys.PRESIDENT,
      );
      if (!presidentRole) return;

      const members = await this.memberRepo.findByChapter(chapterId);
      const president = members.find((m) =>
        m.role_ids.includes(presidentRole.id),
      );
      if (!president) return;

      await this.notificationService.notifyUser(president.user_id, chapterId, {
        title: 'Subscription Status Changed',
        body: `Your chapter subscription is now ${newStatus}`,
        priority: 'URGENT',
        category: 'billing',
        data: { target: { screen: 'billing' } },
      });
    } catch {
      this.logger.warn(`Failed to notify president for chapter ${chapterId}`);
    }
  }

  /** Stripe `event.created` (Unix seconds) as an ISO timestamp. */
  private eventCreatedAt(event: WebhookEvent): string {
    return new Date(event.created * 1000).toISOString();
  }

  /**
   * Timestamp-aware ordering (spec/behavior/billing.md, FRA-242): returns true —
   * and logs — when this event predates the last subscription webhook applied to
   * the chapter, so the caller must ignore it. Every applied subscription webhook
   * stamps `last_stripe_webhook_at` with its `event.created`, so the mark is the
   * newest applied event's time. Two events sharing the same Stripe second are
   * treated as not-stale (applied in delivery order) since sub-second order is
   * unknowable.
   */
  private isStaleWebhook(
    chapter: Chapter,
    event: WebhookEvent,
    eventType: string,
  ): boolean {
    const last = chapter.last_stripe_webhook_at;
    if (last && event.created * 1000 < new Date(last).getTime()) {
      this.logger.warn(
        `Ignoring out-of-order ${eventType} ${event.id} for chapter ` +
          `${chapter.id} (event ${this.eventCreatedAt(event)} older than ` +
          `last applied ${last})`,
      );
      return true;
    }
    return false;
  }

  private mapStripeStatus(stripeStatus: string): SubscriptionStatus | null {
    const mapping: Record<string, SubscriptionStatus> = {
      active: 'active',
      past_due: 'past_due',
      canceled: 'canceled',
      unpaid: 'past_due',
      incomplete: 'incomplete',
      incomplete_expired: 'canceled',
      trialing: 'active',
      paused: 'past_due',
    };
    return mapping[stripeStatus] ?? null;
  }
}
