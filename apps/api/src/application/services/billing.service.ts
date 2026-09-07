import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import {
  BILLING_PROVIDER,
  chargeIdFromLatestCharge,
  customerIdFrom,
  type IBillingProvider,
  type WebhookEvent,
  type CheckoutSessionWebhookObject,
  type SubscriptionWebhookObject,
  type InvoiceWebhookObject,
  type PaymentIntentWebhookObject,
} from '#domain/adapters/billing.interface';
import { FinancialInvoiceService } from './financial-invoice.service';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '#domain/repositories/chapter.repository.interface';
import type {
  Chapter,
  SubscriptionStatus,
} from '#domain/entities/chapter.entity';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import type { IRoleRepository } from '#domain/repositories/role.repository.interface';
import { STRIPE_WEBHOOK_EVENT_REPOSITORY } from '#domain/repositories/stripe-webhook-event.repository.interface';
import type { IStripeWebhookEventRepository } from '#domain/repositories/stripe-webhook-event.repository.interface';
import { SystemRoleKeys } from '#domain/constants/permissions';
import { NotificationService } from './notification.service';
import { ActivationService } from './activation.service';
import { pseudonymizeChapterId } from '../../infrastructure/observability/pseudonyms';

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

/**
 * Silence after reporting one unresolvable chapter reference, so routine
 * cross-environment webhook traffic cannot bury the occurrence that means money
 * moved. Matches `auth-failure-spike.ts`'s window for the same reason.
 */
const UNKNOWN_REF_REPORT_COOLDOWN_MS = 15 * 60_000;

/**
 * Hard cap on tracked references. Unbounded, this map would grow with every
 * distinct unknown id a foreign account sends — the detector becoming the leak
 * it exists to report, exactly as `auth-failure-spike.ts` warns.
 */
const MAX_TRACKED_UNKNOWN_REFS = 500;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  /** Last Sentry report per unresolvable reference — see `shouldReportUnknownRef`. */
  private readonly unknownRefReportedAt = new Map<string, number>();

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
    private readonly activation: ActivationService,
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

    // refuse-new (#929, owner-approved 2026-08-20). A chapter that already owns
    // a *live* subscription recovers through the Customer Portal, which updates
    // that subscription in place. Minting a second one here would double-bill
    // the chapter indefinitely and orphan the first where nothing in the app
    // can surface or cancel it.
    //
    // `canceled` is deliberately *not* refused. A canceled subscription is
    // terminal at Stripe — mapStripeStatus folds both `canceled` and
    // `incomplete_expired` into it — so the Portal cannot resume it and
    // checkout is the chapter's only way back. There is also nothing live left
    // to orphan, and the customer reuse below keeps a returning chapter on one
    // continuous customer instead of forking a second billing history.
    //
    // These refusals ride in `message` rather than a structured `code`, because
    // AllExceptionsFilter drops `code` from every response today (#1020). Both
    // strings are stable and distinct so a client can map them to the portal.
    if (chapter.subscription_status === 'active') {
      throw new BadRequestException(
        'Chapter already has an active subscription. Manage it from the billing portal.',
      );
    }

    if (chapter.subscription_status === 'past_due') {
      throw new BadRequestException(
        'Chapter subscription is past due, not cancelled. Update the payment ' +
          'method from the billing portal — starting a new checkout would ' +
          'create a second subscription and bill the chapter twice.',
      );
    }

    let checkoutUrl: string;
    try {
      // Resolve the customer *before* the session and always pass it down. The
      // adapter has no email fallback (#929), so there is no remaining path on
      // which Stripe mints a Customer of its own.
      //
      // This also repairs a case the issue did not name: on a first checkout
      // the customer created here was never attached to the session, so it was
      // orphaned immediately — and permanently if checkout was abandoned —
      // leaving `POST /v1/billing/portal` opening a portal for a customer that
      // owns no subscription.
      let customerId = chapter.stripe_customer_id;
      if (!customerId) {
        customerId = await this.billingProvider.createCustomer(
          input.customerEmail,
          chapter.name,
        );
        await this.chapterRepo.update(chapter.id, {
          stripe_customer_id: customerId,
        });
      }

      checkoutUrl = await this.billingProvider.createCheckoutSession({
        chapterId: input.chapterId,
        customerId,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        // The trial is once per chapter. Having ever held a subscription is the
        // durable "already had its trial" mark; status is not, since a chapter
        // can return to `canceled` repeatedly. Now that the session carries the
        // chapter's own customer, Stripe can see that history too — but this
        // stays the boundary rather than a second line of defence, because it
        // is keyed on our record rather than on what Stripe infers.
        grantTrial: !chapter.subscription_id,
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

    // Funnel step 6 (#267): intent to pay. Recorded only once Stripe has
    // actually issued the session — a provider failure throws above and must
    // not read as a chapter that reached checkout. This is the step whose gap
    // against step 7 measures checkout abandonment, so counting never-rendered
    // sessions would understate it.
    //
    // Deliberately *outside* the try: `record` swallows its own failures today,
    // but if that ever stopped being true, a telemetry error inside this catch
    // would turn a successfully-created Stripe session into a 503 and orphan
    // it, while the treasurer retries into a second session. Telemetry does not
    // belong inside a payment path's error handling.
    await this.activation.record(
      input.chapterId,
      'activation-checkout-started',
    );

    return checkoutUrl;
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
    const sessionCustomerId = customerIdFrom(session.customer);

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
      this.reportUnknownChapterCheckout(event, chapterId, session);
      return;
    }

    // FRA-242: ignore a redelivered/late checkout that predates a newer event
    // (e.g. Stripe retries an old checkout after the API restart cleared the
    // in-memory idempotency set, when the subscription has since moved on).
    if (this.isStaleWebhook(chapter, event, 'checkout.session.completed')) {
      // One case is not a replay of history but the tail of a race: a
      // subscription event for THIS checkout arrived first, was resolved through
      // the customer and claimed `subscription_id` (see
      // `findChapterBySubscription`), then advanced the high-water mark past
      // this event's `created`. The status and the reference are already right;
      // the only thing this checkout still owes is the conversion milestone,
      // which is keyed uniquely per chapter and so safe to record from here.
      if (subscriptionId && chapter.subscription_id === subscriptionId) {
        await this.activation.record(
          chapterId,
          'activation-checkout-completed',
        );
      }
      return;
    }

    // AC-3 (#929): never *silently* discard a reference to another
    // subscription. With the checkout guard in place this should now be
    // reachable only for a `canceled` chapter resubscribing — where the prior
    // subscription is terminal and replacing the reference is correct — or for
    // a caller that raced the guard. Either way the incoming subscription is
    // the one now billing the chapter and must be stored: dropping the write
    // would leave the chapter paying for a subscription the app cannot see,
    // which is the worse failure. So the reconciliation signal is a loud log,
    // not a refusal.
    if (
      subscriptionId &&
      chapter.subscription_id &&
      subscriptionId !== chapter.subscription_id
    ) {
      this.logger.error(
        `Chapter ${chapterId} completed checkout for subscription ` +
          `${subscriptionId} while still referencing ${chapter.subscription_id}. ` +
          'Replacing the stored reference — verify in Stripe that ' +
          `${chapter.subscription_id} is not still live and billing, and cancel ` +
          'it there if it is.',
      );
    }

    // The same signal for the customer. After #929 the session's customer is
    // the one we sent, so a mismatch here means the chapter has somehow
    // acquired a second customer record — exactly the condition this issue
    // exists to prevent, and worth surfacing rather than absorbing.
    if (
      sessionCustomerId &&
      chapter.stripe_customer_id &&
      sessionCustomerId !== chapter.stripe_customer_id
    ) {
      this.logger.error(
        `Chapter ${chapterId} completed checkout under customer ` +
          `${sessionCustomerId} while referencing ${chapter.stripe_customer_id}. ` +
          'A second customer record exists for this chapter; reconcile in Stripe.',
      );
    }

    await this.chapterRepo.update(chapterId, {
      subscription_status: 'active',
      subscription_id: subscriptionId ?? chapter.subscription_id,
      stripe_customer_id: sessionCustomerId ?? chapter.stripe_customer_id,
      last_stripe_webhook_at: this.eventCreatedAt(event),
    });

    // Funnel step 7 (#267) — the conversion this whole funnel exists to
    // measure. The stale-webhook and non-existent-chapter guards above have
    // already returned, and the milestone table's unique key absorbs Stripe's
    // redeliveries, so a chapter converts exactly once no matter how many times
    // Stripe replays the event.
    await this.activation.record(chapterId, 'activation-checkout-completed');

    this.logger.log(`Chapter ${chapterId} activated via checkout`);
  }

  /**
   * Report a `checkout.session.completed` whose chapter this database does not
   * have (#1710).
   *
   * **Why this still acks instead of throwing.** Throwing is what buys a Stripe
   * retry — `handleWebhookEvent`'s catch arm says so in as many words — and a
   * retry is useless *on this path*, because both ways it is reachable are
   * terminal:
   *
   *  - **Cross-environment delivery, the reachable one.** Local dev and staging
   *    share one Stripe test-mode account (`ENV_REFERENCE.md` § `STRIPE_SECRET_KEY`:
   *    *"Same as staging"*), and Stripe fans every test-mode event out to every
   *    registered endpoint in that account. So a staging checkout reaches a
   *    developer's `stripe listen`, and a local checkout reaches the staging
   *    endpoint. The `chapter_id` is a real UUID from the *other* environment's
   *    database, so the non-UUID guard above cannot catch it, and the row will
   *    never appear here however many times Stripe redelivers.
   *  - **A row removed out of band.** There is no delete path to reach it with —
   *    `IChapterRepository` has no `delete`, nothing in `apps/api/src` deletes
   *    from `chapters`, and no migration drops the table — so this can only come
   *    from manual database intervention, which a redelivery cannot repair
   *    either.
   *
   * Both are properties of *this* handler, which resolves the chapter from
   * `metadata.chapter_id` written at checkout creation. They do **not**
   * generalise to the subscription-resolved handlers, whose unknown-reference
   * branch is reached only by expected traffic now that the checkout race is
   * resolved through the customer — see `findChapterBySubscription` (#1738).
   *
   * The spec's old remedy ("upsert logic … retry naturally") was never built
   * and would be wrong here if it were: upserting would mint a chapter row out
   * of a foreign environment's event.
   *
   * **Why it is louder than the `warn` it replaces.** Acking is right; being
   * *quiet* about it was the defect. The same branch also covers "a paid
   * checkout completed and the chapter was never activated", and at `warn` that
   * was indistinguishable from the benign cross-environment case. This follows
   * `discord-oauth.service.ts`'s `captureSwallowed`: *"a swallowed failure has
   * to report itself."*
   */
  private reportUnknownChapterCheckout(
    event: WebhookEvent,
    chapterId: string,
    session: CheckoutSessionWebhookObject,
  ): void {
    this.reportUnknownChapterRef({
      event,
      kind: 'checkout_unknown_chapter',
      refKey: `checkout:${chapterId}`,
      chapterId,
      detail:
        `chapter ${chapterId} (subscription ${session.subscription ?? 'none'}, ` +
        `customer ${customerIdFrom(session.customer) ?? 'none'}) — nothing was activated`,
      benignCause:
        'this event belongs to another environment sharing this Stripe account',
      realCause:
        'a checkout was paid for a chapter this database cannot see — reconcile it in Stripe',
    });
  }

  /**
   * The reporting seam for "a live Stripe object names a chapter this database
   * cannot resolve".
   *
   * **Only the checkout path reports.** `findChapterBySubscription`
   * deliberately does not call this — see its docblock — so do not read this as
   * covering the subscription-resolved handlers. Since #1738 the transient miss
   * on that path is resolved through the customer rather than reported, and
   * what still falls through (a superseded reference, a foreign subscription)
   * is expected traffic. The seam stays because a second caller is cheap to add
   * if a genuinely alertable case appears there.
   *
   * **The cooldown is load-bearing, not tidiness.** Local dev and staging share
   * a Stripe test-mode account *and* a Sentry DSN (`ENV_REFERENCE.md`: both are
   * "Same as staging"), so routine local billing work reports into the same
   * `frapp-api` project as the real thing. Without a cooldown a developer's
   * afternoon of test checkouts buries the one occurrence that means money
   * moved, and an operator who mutes the issue mutes the signal this exists to
   * raise. Same reasoning, and the same 15-minute window, as
   * `auth-failure-spike.ts`: *"one sustained attack reports once rather than
   * thousands of times."*
   *
   * The per-chapter Sentry tag is what makes distinct chapters distinguishable
   * rather than collapsing into one issue keyed on a constant message. It is
   * hashed **here**, for the reason `AllExceptionsFilter.reportToSentry` gives:
   * the scrubber drops a raw UUID in `event.user.id` rather than hashing it, so
   * hashing at the source is what keeps the tag correlatable with the 5xx
   * events already tagged `chapter`.
   *
   * Inherits `auth-failure-spike.ts`'s limits, and they are acceptable for the
   * same reason: the map is in-memory, so it is per-instance and lost on
   * restart, and it is bounded, so a churn of unknown references evicts rather
   * than growing without limit. Under-reporting a duplicate is fine; the log
   * line below is the complete record and is emitted every time.
   */
  private reportUnknownChapterRef(params: {
    event: WebhookEvent;
    kind: 'checkout_unknown_chapter';
    refKey: string;
    /**
     * Required, not optional: the chapter tag is what keeps occurrences from
     * collapsing into one Sentry issue keyed on the constant message, and the
     * one caller that legitimately had no chapter to name is gone. A future
     * caller without one should make that explicit rather than silently
     * dropping the tag.
     */
    chapterId: string;
    detail: string;
    benignCause: string;
    realCause: string;
  }): void {
    const { event, kind, refKey, chapterId, detail } = params;

    // Emitted on every occurrence — this is the forensic record, and only the
    // Sentry alert is rate-limited. "marked processed" rather than "Stripe will
    // not redeliver": `markProcessed` runs after this returns and can itself
    // fail, in which case Stripe does retry.
    this.logger.error(
      `${event.type} names a chapter this database does not have: ${detail} ` +
        `(event ${event.id}). The event is marked processed, so Stripe will ` +
        `not retry it once this response returns 2xx. If ${params.benignCause}, ` +
        `that is expected and no action is needed. Otherwise ${params.realCause}.`,
    );

    if (!this.shouldReportUnknownRef(refKey)) return;

    // Never let a reporting failure change the webhook's outcome: the ack is
    // the correct result with or without Sentry. Same posture as the
    // security-event emitter in AllExceptionsFilter.
    try {
      const tags: Record<string, string> = {
        billing_event: kind,
        stripe_event_type: event.type,
        stripe_event_id: event.id,
      };
      const chapterHash = pseudonymizeChapterId(chapterId);
      if (chapterHash) tags.chapter = chapterHash;

      Sentry.captureMessage(
        `${event.type} for a chapter this database does not have`,
        { level: 'error', tags },
      );
    } catch (error) {
      this.logger.warn(
        `Sentry report failed for ${kind} ${event.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** True when this reference has not been reported inside the cooldown. */
  private shouldReportUnknownRef(refKey: string): boolean {
    const now = Date.now();
    const last = this.unknownRefReportedAt.get(refKey);
    if (last !== undefined && now - last < UNKNOWN_REF_REPORT_COOLDOWN_MS) {
      return false;
    }

    // Re-insert so iteration order stays least-recently-reported first, which
    // is what makes the eviction below drop the coldest entry rather than an
    // arbitrary one.
    this.unknownRefReportedAt.delete(refKey);
    if (this.unknownRefReportedAt.size >= MAX_TRACKED_UNKNOWN_REFS) {
      const oldest = this.unknownRefReportedAt.keys().next();
      if (!oldest.done) this.unknownRefReportedAt.delete(oldest.value);
    }
    this.unknownRefReportedAt.set(refKey, now);
    return true;
  }

  private async handleSubscriptionUpdated(event: WebhookEvent): Promise<void> {
    const subscription = event.data.object as SubscriptionWebhookObject;
    if (!subscription.id) {
      this.logger.warn(
        `customer.subscription.updated missing subscription id: ${event.id}`,
      );
      return;
    }
    const chapter = await this.findChapterBySubscription(
      subscription.id,
      customerIdFrom(subscription.customer),
    );
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
    const chapter = await this.findChapterBySubscription(
      subscription.id,
      customerIdFrom(subscription.customer),
    );
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

    const chapter = await this.findChapterBySubscription(
      subscriptionId,
      customerIdFrom(invoice.customer),
    );
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
    // A paid invoice for the chapter's subscription means that subscription is
    // live, so it lifts both non-live states this handler can meet:
    //
    //  - `past_due`: the dunning recovery this handler has always done.
    //  - `incomplete`: the first invoice of a checkout whose `invoice.paid`
    //    overtook its own `checkout.session.completed` (#1738). The resolver
    //    above has just claimed `subscription_id` and this write advances the
    //    high-water mark past the checkout's `created`, so the checkout will be
    //    dropped as stale — if activation were left to it, the chapter would
    //    stay `incomplete` under a paid subscription for good. The same rule
    //    also covers a checkout that Stripe itself left `incomplete` (initial
    //    payment failed) and the member then paid: `invoice.paid` and
    //    `customer.subscription.updated` (`active`) both arrive, and it is
    //    correct for either to activate.
    if (
      chapter.subscription_status === 'past_due' ||
      chapter.subscription_status === 'incomplete'
    ) {
      update.subscription_status = 'active';
      update.past_due_since = null;
    }

    await this.chapterRepo.update(chapter.id, update);

    if (update.subscription_status === 'active') {
      // Activation via payment is expected and intentionally silent — president
      // status-change alerts are limited to the subscription updated/deleted paths.
      this.logger.log(`Chapter ${chapter.id} activated via invoice payment`);
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

  /**
   * Resolve the chapter a subscription-shaped event belongs to.
   *
   * **The primary key is `subscription_id`, and it has a gap (#1738).** That
   * column is written by `handleCheckoutCompleted`, and Stripe guarantees no
   * ordering between `checkout.session.completed` and the subscription events
   * for the same checkout. An event that overtakes its own checkout therefore
   * finds no row by subscription — and acking it there would lose that status
   * transition permanently, because Stripe never redelivers an acked event.
   *
   * **The fallback is the customer, and it works because of write order.**
   * `createCheckoutSession` resolves the Stripe customer and persists
   * `stripe_customer_id` *before* the session is created, so the column is
   * populated in exactly the ordering that leaves `subscription_id` empty. The
   * subscription and invoice payloads both carry `customer`, and the column is
   * `unique`, so the lookup is exact.
   *
   * The fallback is refused **while the chapter's stored subscription is
   * live** (`active` or `past_due` — exactly the statuses `createCheckoutSession`
   * refuses to open a second checkout for). A live chapter pointing at a
   * *different* subscription is the superseded-reference case:
   * `handleCheckoutCompleted` overwrites `subscription_id` when a canceled
   * chapter resubscribes and tells the operator to cancel the old subscription
   * in Stripe, which emits `customer.subscription.deleted` for the old id.
   * Resolving *that* through the customer would cancel the chapter's live
   * subscription — so it stays acked and unresolved, by design.
   *
   * A chapter whose stored subscription is **not** live (`canceled`, or an
   * `incomplete` leftover) is the mirror image: the only way its customer
   * acquires a different subscription is the resubscribe checkout the product
   * offers it, so an event for a new id is that checkout's own subscription
   * event overtaking it — the same race as the first checkout, one row later.
   * The reference is overwritten and the transition applied. An event for the
   * *stored* id never reaches this branch at all; `findBySubscriptionId` above
   * resolves it directly. The same-id live case can still land here if checkout
   * commits between those two lookups — that is already ours and is returned,
   * not refused.
   *
   * **The resolved reference is claimed immediately**, and the write is a
   * compare-and-set (`claimSubscriptionId`): it updates only while the stored
   * `subscription_id` is still the one this read saw (null, or a non-live
   * leftover) and the chapter is not live. Two events racing the same empty
   * (or canceled) row cannot both apply — the loser updates zero rows, reloads
   * by its own subscription id, and continues only when that id owns the
   * chapter; otherwise it acks as superseded. The claim is not left for the
   * checkout. If the overtaking event's `created` is later than the checkout's
   * — a slow or retried checkout delivery — the checkout is then dropped as
   * stale by `isStaleWebhook`, and without this write nothing would ever
   * record which subscription bills the chapter: `grantTrial:
   * !chapter.subscription_id` would grant a second trial on the next checkout,
   * and `getChapterBillingStatus` would report none.
   *
   * **What remains at `warn`, and why it still raises no Sentry event.** With
   * the race resolved, the unresolvable branch is reached by two things: the
   * superseded reference above (expected — the product instructs the flow that
   * produces it) and a subscription genuinely foreign to this database
   * (cross-environment delivery on the shared test-mode account, see
   * `reportUnknownChapterCheckout`). Both are correctly acked and neither is a
   * lost transition, so alerting here would page on expected traffic.
   */
  private async findChapterBySubscription(
    subscriptionId: string,
    customerId: string | null,
  ): Promise<Chapter | null> {
    const bySubscription =
      await this.chapterRepo.findBySubscriptionId(subscriptionId);
    if (bySubscription) return bySubscription;

    if (!customerId) {
      this.logger.warn(
        `No chapter found for subscription: ${subscriptionId} (event carried no customer to fall back on)`,
      );
      return null;
    }

    const byCustomer = await this.chapterRepo.findByCustomerId(customerId);
    if (!byCustomer) {
      this.logger.warn(
        `No chapter found for subscription: ${subscriptionId} (customer ${customerId} is unknown here — foreign subscription, acked)`,
      );
      return null;
    }

    if (byCustomer.subscription_id === subscriptionId) {
      // Checkout (or a sibling event) wrote this id between our miss-by-sub
      // lookup and the customer fallback. Already ours — do not treat it as a
      // superseded reference, and do not try to claim a live row.
      return byCustomer;
    }

    const storedIsLive =
      byCustomer.subscription_status === 'active' ||
      byCustomer.subscription_status === 'past_due';
    if (byCustomer.subscription_id && storedIsLive) {
      this.logger.warn(
        `No chapter found for subscription: ${subscriptionId} (customer ${customerId} is chapter ` +
          `${byCustomer.id}, which references live subscription ${byCustomer.subscription_id} — ` +
          'superseded reference, acked)',
      );
      return null;
    }

    this.logger.log(
      `Resolved subscription ${subscriptionId} to chapter ${byCustomer.id} via customer ` +
        `${customerId}: the event overtook its own checkout.session.completed` +
        (byCustomer.subscription_id
          ? ` (replacing non-live reference ${byCustomer.subscription_id}).`
          : '.') +
        ' Claiming the reference.',
    );

    const claimed = await this.chapterRepo.claimSubscriptionId(
      byCustomer.id,
      subscriptionId,
      byCustomer.subscription_id,
    );
    if (claimed) return claimed;

    // Lost the race: another event claimed this chapter. Continue only when
    // that claim was for *this* subscription (two deliveries of the same sub);
    // a different winner is a superseded reference and must not apply.
    const winner = await this.chapterRepo.findBySubscriptionId(subscriptionId);
    if (winner) return winner;

    this.logger.warn(
      `No chapter found for subscription: ${subscriptionId} (customer ${customerId} is chapter ` +
        `${byCustomer.id}, which lost the subscription_id claim — superseded, acked)`,
    );
    return null;
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
