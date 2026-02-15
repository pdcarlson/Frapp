import { Test, TestingModule } from '@nestjs/testing';
import { StripeWebhookGuard } from './stripe-webhook.guard';
import {
  BILLING_PROVIDER,
  IBillingProvider,
} from '../../domain/adapters/billing.interface';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

describe('StripeWebhookGuard', () => {
  let guard: StripeWebhookGuard;
  let billingProvider: jest.Mocked<IBillingProvider>;

  const mockExecutionContext = {
    switchToHttp: jest.fn().mockReturnThis(),
    getRequest: jest.fn(),
  } as unknown as ExecutionContext;

  beforeEach(async () => {
    const mockBilling: Partial<jest.Mocked<IBillingProvider>> = {
      verifyWebhook: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeWebhookGuard,
        { provide: BILLING_PROVIDER, useValue: mockBilling },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'STRIPE_WEBHOOK_SECRET') return 'whsec_test';
              return null;
            }),
          },
        },
      ],
    }).compile();

    guard = module.get<StripeWebhookGuard>(StripeWebhookGuard);
    billingProvider = module.get(BILLING_PROVIDER);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('should allow access with valid stripe signature', async () => {
      const mockRequest = {
        headers: { 'stripe-signature': 'sig_123' },
        body: 'raw_payload',
      };
      (
        mockExecutionContext.switchToHttp().getRequest as jest.Mock
      ).mockReturnValue(mockRequest);

      const mockEvent = {
        type: 'subscription.created',
        stripeCustomerId: 'cus_123',
        subscriptionId: 'sub_123',
        status: 'active',
      };
      billingProvider.verifyWebhook.mockReturnValue(mockEvent as any);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest['billingEvent']).toEqual(mockEvent);
    });

    it('should deny access if header is missing', () => {
      const mockRequest = { headers: {}, body: {} };
      (
        mockExecutionContext.switchToHttp().getRequest as jest.Mock
      ).mockReturnValue(mockRequest);

      expect(() => guard.canActivate(mockExecutionContext)).toThrow(
        UnauthorizedException,
      );
    });

    it('should throw Error if secret is not configured', () => {
      const mockRequest = {
        headers: { 'stripe-signature': 'sig_123' },
        body: 'payload',
      };
      (
        mockExecutionContext.switchToHttp().getRequest as jest.Mock
      ).mockReturnValue(mockRequest);

      // Setup guard with missing secret
      const configServiceMock = {
        get: jest.fn().mockReturnValue(null),
      };
      const guardWithNoSecret = new StripeWebhookGuard(
        billingProvider,
        configServiceMock as any,
      );

      expect(() => guardWithNoSecret.canActivate(mockExecutionContext)).toThrow(
        'Webhook secret not configured',
      );
    });

    it('should return false if event is invalid/unhandled', async () => {
      const mockRequest = {
        headers: { 'stripe-signature': 'sig_123' },
        body: 'raw_payload',
      };
      (
        mockExecutionContext.switchToHttp().getRequest as jest.Mock
      ).mockReturnValue(mockRequest);
      billingProvider.verifyWebhook.mockReturnValue(null);

      const result = await guard.canActivate(mockExecutionContext);
      expect(result).toBe(false);
    });
  });
});
