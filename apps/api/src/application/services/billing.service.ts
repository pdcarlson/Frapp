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
  type IBillingProvider,
  type WebhookEvent,
  type CheckoutSessionWebhookObject,
  type SubscriptionWebhookObject,
  type InvoiceWebhookObject,
} from '../../domain/adapters/billing.interface';
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

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly processedEventIds = new Set<string>();

  constructor(
    @Inject(BILLING_PROVIDER)
    private readonly billingProvider: IBillingProvider,
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapterRepo: IChapterRepository,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
    @Inject(ROLE_REPOSITORY)
    private readonly roleRepo: IRoleRepository,
    private readonly notificationService: NotificationService,
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

  async handleWebhookEvent(event: WebhookEvent): Promise<void> {
    if (this.processedEventIds.has(event.id)) {
      this.logger.debug(`Skipping already-processed event ${event.id}`);
      return;
    }

    this.logger.log(`Processing webhook event: ${event.type} (${event.id})`);

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
      default:
        this.logger.debug(`Unhandled webhook event type: ${event.type}`);
    }

    this.processedEventIds.add(event.id);
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

    const chapter = await this.chapterRepo.findById(chapterId);
    if (!chapter) {
      this.logger.warn(
        `checkout.session.completed for non-existent chapter: ${chapterId}`,
      );
      return;
    }

    await this.chapterRepo.update(chapterId, {
      subscription_status: 'active',
      subscription_id: subscriptionId ?? chapter.subscription_id,
      stripe_customer_id: session.customer ?? chapter.stripe_customer_id,
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

    await this.chapterRepo.update(chapter.id, {
      subscription_status: newStatus,
    });

    await this.notifyChapterPresident(chapter.id, newStatus);

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

    await this.chapterRepo.update(chapter.id, {
      subscription_status: 'canceled',
    });

    await this.notifyChapterPresident(chapter.id, 'canceled');

    this.logger.log(`Chapter ${chapter.id} subscription canceled`);
  }

  private async handleInvoicePaid(event: WebhookEvent): Promise<void> {
    const invoice = event.data.object as InvoiceWebhookObject;
    const subscriptionId = invoice.subscription;
    if (!subscriptionId) return;

    const chapter = await this.findChapterBySubscription(subscriptionId);
    if (!chapter) return;

    if (chapter.subscription_status === 'past_due') {
      await this.chapterRepo.update(chapter.id, {
        subscription_status: 'active',
      });
      this.logger.log(`Chapter ${chapter.id} reactivated via invoice payment`);
    }
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
      const presidentRole = await this.roleRepo.findByChapterAndName(
        chapterId,
        'President',
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
