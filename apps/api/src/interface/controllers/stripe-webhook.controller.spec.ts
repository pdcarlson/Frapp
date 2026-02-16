import { Test, TestingModule } from '@nestjs/testing';
import { StripeWebhookController } from './stripe-webhook.controller';
import { ChapterOnboardingService } from '../../application/services/chapter-onboarding.service';
import { FinancialService } from '../../application/services/financial.service';
import { StripeWebhookGuard } from '../guards/stripe-webhook.guard';

describe('StripeWebhookController', () => {
  let controller: StripeWebhookController;
  let onboardingService: {
    handleBillingWebhook: jest.Mock;
  };
  let financialService: {
    processPayment: jest.Mock;
  };

  const mockOnboardingService = {
    handleBillingWebhook: jest.fn(),
  };

  const mockFinancialService = {
    processPayment: jest.fn(),
  };

  const mockGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeWebhookController],
      providers: [
        { provide: ChapterOnboardingService, useValue: mockOnboardingService },
        { provide: FinancialService, useValue: mockFinancialService },
      ],
    })
      .overrideGuard(StripeWebhookGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<StripeWebhookController>(StripeWebhookController);
    onboardingService = mockOnboardingService;
    financialService = mockFinancialService;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate subscription events to onboarding service', async () => {
    const req = {
      billingEvent: { type: 'subscription.created' },
    };
    await controller.handleWebhook(req as any);
    expect(onboardingService.handleBillingWebhook).toHaveBeenCalledWith(
      req.billingEvent,
    );
    expect(financialService.processPayment).not.toHaveBeenCalled();
  });

  it('should delegate invoice events to financial service', async () => {
    const req = {
      billingEvent: {
        type: 'invoice.payment_succeeded',
        paymentIntentId: 'pi_123',
        metadata: { invoiceId: 'inv_123' },
      },
    };
    await controller.handleWebhook(req as any);
    expect(financialService.processPayment).toHaveBeenCalledWith(
      'inv_123',
      'pi_123',
    );
    expect(onboardingService.handleBillingWebhook).not.toHaveBeenCalled();
  });
});
