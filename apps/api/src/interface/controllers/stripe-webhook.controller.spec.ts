/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { StripeWebhookController } from './stripe-webhook.controller';
import { ChapterOnboardingService } from '../../application/services/chapter-onboarding.service';
import { StripeWebhookGuard } from '../guards/stripe-webhook.guard';
import { BillingStatus } from '../../domain/adapters/billing.interface';
import { RequestWithHeaders } from '../auth.types';

describe('StripeWebhookController', () => {
  let controller: StripeWebhookController;
  let onboardingService: jest.Mocked<ChapterOnboardingService>;

  const mockOnboardingService = {
    handleBillingWebhook: jest.fn(),
  };

  const mockRequest = {
    billingEvent: {
      type: 'subscription.created',
      stripeCustomerId: 'cus_123',
      subscriptionId: 'sub_123',
      status: BillingStatus.ACTIVE,
    },
  } as unknown as RequestWithHeaders;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeWebhookController],
      providers: [
        {
          provide: ChapterOnboardingService,
          useValue: mockOnboardingService,
        },
      ],
    })
      .overrideGuard(StripeWebhookGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<StripeWebhookController>(StripeWebhookController);
    onboardingService = module.get(ChapterOnboardingService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('handleWebhook', () => {
    it('should call handleBillingWebhook with the event from request', async () => {
      const result = await controller.handleWebhook(mockRequest);

      expect(result).toEqual({ received: true });
      expect(onboardingService.handleBillingWebhook).toHaveBeenCalledWith(
        mockRequest.billingEvent,
      );
    });
  });
});
