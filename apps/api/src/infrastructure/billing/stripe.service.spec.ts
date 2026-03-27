import { ConfigService } from '@nestjs/config';
import { StripeBillingService } from './stripe.service';
import Stripe from 'stripe';

jest.mock('stripe');

describe('StripeBillingService', () => {
  let service: StripeBillingService;
  let configService: ConfigService;
  let stripeMock: jest.Mocked<Stripe>;

  beforeEach(() => {
    configService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'STRIPE_SECRET_KEY') return 'test_secret_key';
        if (key === 'STRIPE_PRICE_ID') return 'test_price_id';
        if (key === 'STRIPE_WEBHOOK_SECRET') return 'test_webhook_secret';
        throw new Error(`Unexpected config key: ${key}`);
      }),
    } as any;

    service = new StripeBillingService(configService);
    stripeMock = (service as any).stripe;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(configService.getOrThrow).toHaveBeenCalledWith('STRIPE_SECRET_KEY');
    expect(configService.getOrThrow).toHaveBeenCalledWith('STRIPE_PRICE_ID');
    expect(configService.getOrThrow).toHaveBeenCalledWith(
      'STRIPE_WEBHOOK_SECRET',
    );
  });

  describe('createCustomer', () => {
    it('should create a customer and return their id', async () => {
      const email = 'test@example.com';
      const name = 'Test User';
      const expectedId = 'cus_123';

      stripeMock.customers = {
        create: jest.fn().mockResolvedValue({ id: expectedId }),
      } as any;

      const result = await service.createCustomer(email, name);

      expect(result).toBe(expectedId);
      expect(stripeMock.customers.create).toHaveBeenCalledWith({ email, name });
    });
  });

  describe('createCheckoutSession', () => {
    it('should create a checkout session and return the url', async () => {
      const params = {
        chapterId: 'chap_123',
        customerEmail: 'test@example.com',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      };
      const expectedUrl = 'https://checkout.stripe.com/c/pay/cs_test_123';

      stripeMock.checkout = {
        sessions: {
          create: jest.fn().mockResolvedValue({ url: expectedUrl }),
        },
      } as any;

      const result = await service.createCheckoutSession(params);

      expect(result).toBe(expectedUrl);
      expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith({
        mode: 'subscription',
        customer_email: params.customerEmail,
        line_items: [{ price: 'test_price_id', quantity: 1 }],
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        metadata: { chapter_id: params.chapterId },
      });
    });
  });

  describe('createCustomerPortalSession', () => {
    it('should create a customer portal session and return the url', async () => {
      const params = {
        customerId: 'cus_123',
        returnUrl: 'https://example.com/account',
      };
      const expectedUrl = 'https://billing.stripe.com/p/session/test_123';

      stripeMock.billingPortal = {
        sessions: {
          create: jest.fn().mockResolvedValue({ url: expectedUrl }),
        },
      } as any;

      const result = await service.createCustomerPortalSession(params);

      expect(result).toBe(expectedUrl);
      expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: params.customerId,
        return_url: params.returnUrl,
      });
    });
  });

  describe('getSubscriptionStatus', () => {
    it('should retrieve a subscription and return its status', async () => {
      const subscriptionId = 'sub_123';
      const expectedStatus = 'active';

      stripeMock.subscriptions = {
        retrieve: jest.fn().mockResolvedValue({ status: expectedStatus }),
      } as any;

      const result = await service.getSubscriptionStatus(subscriptionId);

      expect(result).toBe(expectedStatus);
      expect(stripeMock.subscriptions.retrieve).toHaveBeenCalledWith(
        subscriptionId,
      );
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel a subscription', async () => {
      const subscriptionId = 'sub_123';

      stripeMock.subscriptions = {
        cancel: jest.fn().mockResolvedValue({}),
      } as any;

      await service.cancelSubscription(subscriptionId);

      expect(stripeMock.subscriptions.cancel).toHaveBeenCalledWith(
        subscriptionId,
      );
    });
  });

  describe('constructWebhookEvent', () => {
    it('should construct and map a webhook event', () => {
      const payload = Buffer.from('test_payload');
      const signature = 'test_signature';

      const mockStripeEvent = {
        id: 'evt_123',
        type: 'checkout.session.completed',
        created: 1234567890,
        data: {
          object: { foo: 'bar' },
        },
      };

      stripeMock.webhooks = {
        constructEvent: jest.fn().mockReturnValue(mockStripeEvent),
      } as any;

      const result = service.constructWebhookEvent(payload, signature);

      expect(result).toEqual({
        id: mockStripeEvent.id,
        type: mockStripeEvent.type,
        created: mockStripeEvent.created,
        data: {
          object: mockStripeEvent.data.object,
        },
      });
      expect(stripeMock.webhooks.constructEvent).toHaveBeenCalledWith(
        payload,
        signature,
        'test_webhook_secret',
      );
    });
  });
});
