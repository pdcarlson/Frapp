/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { StripeService } from './stripe.service';
import { ConfigService } from '@nestjs/config';

// Mock Stripe SDK
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    customers: {
      create: jest.fn(),
    },
    checkout: {
      sessions: {
        create: jest.fn(),
      },
    },
    webhooks: {
      constructEvent: jest.fn(),
    },
  }));
});

describe('StripeService', () => {
  let service: StripeService;
  let stripeMock: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'STRIPE_SECRET_KEY') return 'sk_test_123';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<StripeService>(StripeService);
    stripeMock = (service as any).stripe;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createCustomer', () => {
    it('should call stripe.customers.create and return id', async () => {
      stripeMock.customers.create.mockResolvedValue({ id: 'cus_123' });

      const result = await service.createCustomer(
        'test@example.com',
        'Test User',
      );

      expect(result).toBe('cus_123');
      expect(stripeMock.customers.create).toHaveBeenCalledWith({
        email: 'test@example.com',
        name: 'Test User',
      });
    });
  });

  describe('createCheckoutSession', () => {
    it('should call stripe.checkout.sessions.create and return url', async () => {
      stripeMock.checkout.sessions.create.mockResolvedValue({
        url: 'https://checkout.stripe.com/pay/123',
      });

      const result = await service.createCheckoutSession(
        'cus_123',
        'price_123',
        'http://success.com',
        'http://cancel.com',
      );

      expect(result).toBe('https://checkout.stripe.com/pay/123');
      expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_123',
          mode: 'subscription',
          success_url: 'http://success.com',
          cancel_url: 'http://cancel.com',
        }),
      );
    });
  });

  describe('verifyWebhook', () => {
    it('should map subscription events correctly', () => {
      const mockEvent = {
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_123',
            customer: 'cus_123',
            status: 'active',
          },
        },
      };
      stripeMock.webhooks.constructEvent.mockReturnValue(mockEvent);

      const result = service.verifyWebhook('payload', 'sig', 'secret');

      expect(result).toEqual({
        type: 'subscription.created',
        stripeCustomerId: 'cus_123',
        subscriptionId: 'sub_123',
        status: 'active',
      });
    });

    it('should map subscription status past_due correctly', () => {
      const mockEvent = {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_123',
            customer: 'cus_123',
            status: 'past_due',
          },
        },
      };
      stripeMock.webhooks.constructEvent.mockReturnValue(mockEvent);

      const result = service.verifyWebhook('payload', 'sig', 'secret');

      expect(result?.status).toBe('past_due');
    });

    it('should map subscription status canceled correctly', () => {
      const mockEvent = {
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_123',
            customer: 'cus_123',
            status: 'canceled',
          },
        },
      };
      stripeMock.webhooks.constructEvent.mockReturnValue(mockEvent);

      const result = service.verifyWebhook('payload', 'sig', 'secret');

      expect(result?.status).toBe('canceled');
      expect(result?.type).toBe('subscription.deleted');
    });

    it('should return null for unhandled events', () => {
      const mockEvent = { type: 'other.event' };
      stripeMock.webhooks.constructEvent.mockReturnValue(mockEvent);

      const result = service.verifyWebhook('payload', 'sig', 'secret');

      expect(result).toBeNull();
    });

    it('should throw error if signature is invalid', () => {
      stripeMock.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('Invalid');
      });

      expect(() => service.verifyWebhook('p', 's', 'sec')).toThrow('Invalid');
    });
  });
});
