/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ChapterOnboardingService } from './chapter-onboarding.service';
import {
  CHAPTER_REPOSITORY,
  IChapterRepository,
} from '../../domain/repositories/chapter.repository.interface';
import {
  BILLING_PROVIDER,
  IBillingProvider,
  BillingStatus,
} from '../../domain/adapters/billing.interface';
import { ConfigService } from '@nestjs/config';
import { Chapter } from '../../domain/entities/chapter.entity';
import { Logger } from '@nestjs/common';

describe('ChapterOnboardingService', () => {
  let service: ChapterOnboardingService;
  let chapterRepo: jest.Mocked<IChapterRepository>;
  let billingProvider: jest.Mocked<IBillingProvider>;

  const mockChapter = new Chapter(
    'uuid-123',
    'Sigma Chi',
    'OSU',
    null,
    null,
    'incomplete',
    null,
    new Date(),
    new Date(),
  );

  beforeEach(async () => {
    const mockRepo: Partial<jest.Mocked<IChapterRepository>> = {
      create: jest.fn(),
      update: jest.fn(),
      findByStripeCustomerId: jest.fn(),
    };

    const mockBilling: Partial<jest.Mocked<IBillingProvider>> = {
      createCustomer: jest.fn(),
      createCheckoutSession: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChapterOnboardingService,
        { provide: CHAPTER_REPOSITORY, useValue: mockRepo },
        { provide: BILLING_PROVIDER, useValue: mockBilling },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => 'price_123') },
        },
      ],
    }).compile();

    service = module.get<ChapterOnboardingService>(ChapterOnboardingService);
    chapterRepo = module.get(CHAPTER_REPOSITORY);
    billingProvider = module.get(BILLING_PROVIDER);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('initiateOnboarding', () => {
    it('should create chapter and return checkout URL', async () => {
      const dto = { name: 'Sigma Chi', university: 'OSU' };
      const userEmail = 'admin@example.com';

      chapterRepo.create.mockResolvedValue(mockChapter);
      billingProvider.createCustomer.mockResolvedValue('cus_123');
      billingProvider.createCheckoutSession.mockResolvedValue(
        'https://checkout.stripe.com',
      );

      const result = await service.initiateOnboarding(dto, userEmail);

      expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com' });
      expect(chapterRepo.create).toHaveBeenCalled();
      expect(billingProvider.createCustomer).toHaveBeenCalledWith(
        userEmail,
        dto.name,
      );
    });

    it('should throw if billing provider fails', async () => {
      billingProvider.createCustomer.mockRejectedValue(
        new Error('Stripe Down'),
      );

      await expect(
        service.initiateOnboarding(
          { name: 'test', university: 'test' },
          'test@test.com',
        ),
      ).rejects.toThrow('Stripe Down');
    });
  });

  describe('handleBillingWebhook', () => {
    it('should activate chapter on subscription.created', async () => {
      const event = {
        type: 'subscription.created' as any,
        stripeCustomerId: 'cus_123',
        subscriptionId: 'sub_123',
        status: BillingStatus.ACTIVE,
      };

      chapterRepo.findByStripeCustomerId.mockResolvedValue(mockChapter);
      chapterRepo.update.mockResolvedValue({
        ...mockChapter,
        subscriptionStatus: 'active',
      } as any as Chapter);

      await service.handleBillingWebhook(event);

      expect(chapterRepo.update).toHaveBeenCalledWith(mockChapter.id, {
        subscriptionStatus: 'active',
        subscriptionId: 'sub_123',
      });
    });

    it('should warn and return if chapter is not found for stripeCustomerId', async () => {
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation();
      const event = {
        type: 'subscription.created' as any,
        stripeCustomerId: 'unknown_cus',
        subscriptionId: 'sub_123',
        status: BillingStatus.ACTIVE,
      };

      chapterRepo.findByStripeCustomerId.mockResolvedValue(null);

      await service.handleBillingWebhook(event);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Received billing event for unknown customer'),
      );
    });

    it('should throw InternalServerErrorException if update fails', async () => {
      const event = {
        type: 'subscription.created' as any,
        stripeCustomerId: 'cus_123',
        subscriptionId: 'sub_123',
        status: BillingStatus.ACTIVE,
      };

      chapterRepo.findByStripeCustomerId.mockResolvedValue(mockChapter);
      chapterRepo.update.mockRejectedValue(new Error('Update failed'));

      await expect(service.handleBillingWebhook(event)).rejects.toThrow(
        'Webhook processing failed',
      );
    });
  });
});
