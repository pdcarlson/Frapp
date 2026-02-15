import {
  Inject,
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { CHAPTER_REPOSITORY } from '../../domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '../../domain/repositories/chapter.repository.interface';
import {
  BILLING_PROVIDER,
  BillingEvent,
} from '../../domain/adapters/billing.interface';
import type { IBillingProvider } from '../../domain/adapters/billing.interface';
import { ConfigService } from '@nestjs/config';
import { OnboardingInitDto } from '../../interface/dtos/onboarding-init.dto';

@Injectable()
export class ChapterOnboardingService {
  private readonly logger = new Logger(ChapterOnboardingService.name);

  constructor(
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapterRepo: IChapterRepository,
    @Inject(BILLING_PROVIDER)
    private readonly billingProvider: IBillingProvider,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Orchestrates the creation of a new chapter and the initiation of payment.
   */
  async initiateOnboarding(
    dto: OnboardingInitDto,
    userEmail: string,
  ): Promise<{ checkoutUrl: string }> {
    this.logger.log(`Initiating onboarding for chapter: ${dto.name}`);

    try {
      // 1. Create the chapter record (Incomplete status)
      const chapter = await this.chapterRepo.create({
        name: dto.name,
        university: dto.university,
        clerkOrganizationId: dto.clerkOrganizationId,
        subscriptionStatus: 'incomplete',
      });

      // 2. Create customer in billing provider
      const stripeCustomerId = await this.billingProvider.createCustomer(
        userEmail,
        dto.name,
      );

      // 3. Update chapter with billing ID
      await this.chapterRepo.update(chapter.id, {
        stripeCustomerId,
      });

      // 4. Create checkout session
      const priceId = this.configService.get<string>('STRIPE_PRICE_ID');
      const successUrl = this.configService.get<string>('STRIPE_SUCCESS_URL');
      const cancelUrl = this.configService.get<string>('STRIPE_CANCEL_URL');

      if (!priceId || !successUrl || !cancelUrl) {
        throw new Error('Billing configuration is missing');
      }

      const checkoutUrl = await this.billingProvider.createCheckoutSession(
        stripeCustomerId,
        priceId,
        successUrl,
        cancelUrl,
      );

      return { checkoutUrl };
    } catch (error) {
      this.logger.error(
        `Onboarding failed for ${dto.name} | User: ${userEmail}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Handles normalized billing events from our adapters.
   */
  async handleBillingWebhook(event: BillingEvent): Promise<void> {
    this.logger.log(
      `Processing billing event: ${event.type} | Customer: ${event.stripeCustomerId}`,
    );

    try {
      const chapter = await this.chapterRepo.findByStripeCustomerId(
        event.stripeCustomerId,
      );

      if (!chapter) {
        this.logger.warn(
          `Received billing event for unknown customer: ${event.stripeCustomerId}`,
        );
        return;
      }

      await this.chapterRepo.update(chapter.id, {
        subscriptionStatus: event.status,
        subscriptionId: event.subscriptionId,
      });

      this.logger.log(
        `Successfully updated chapter ${chapter.id} status to ${event.status}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process billing event for customer: ${event.stripeCustomerId}`,
        error,
      );
      throw new InternalServerErrorException('Webhook processing failed');
    }
  }
}
