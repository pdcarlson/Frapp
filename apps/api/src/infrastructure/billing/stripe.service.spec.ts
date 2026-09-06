import { ConfigService } from '@nestjs/config';
import { StripeBillingService } from './stripe.service';
import { chargeIdFromLatestCharge } from '#domain/adapters/billing.interface';
import Stripe from 'stripe';

jest.mock('stripe');

/**
 * The automocked Stripe constructor keeps `errors.*` as (mocked) classes, so
 * `instanceof` in the service still matches — but the mock constructor sets no
 * fields, hence the explicit `code` assignment.
 */
const stripeInvalidRequestError = (code?: string): Error => {
  const error = new Stripe.errors.StripeInvalidRequestError({
    type: 'invalid_request_error',
    message: 'No such payment_intent',
  } as never) as Error & { code?: string };
  error.code = code;
  return error;
};

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
        customerId: 'cus_existing',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        grantTrial: true,
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
        // The chapter's own customer, never an email (#929). Passing an email
        // made Stripe mint a fresh Customer per checkout, so a repeat checkout
        // could not be recognised as the same chapter and the previous
        // subscription was orphaned.
        customer: params.customerId,
        line_items: [{ price: 'test_price_id', quantity: 1 }],
        subscription_data: { trial_period_days: 14 },
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        metadata: { chapter_id: params.chapterId },
      });
    });

    const checkoutParams = (grantTrial: boolean) => ({
      chapterId: 'chapter-123',
      customerId: 'cus_existing',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      grantTrial,
    });

    const capturedSessionArgs = () =>
      (stripeMock.checkout.sessions.create as jest.Mock).mock.calls[0][0];

    const mockCheckout = () => {
      stripeMock.checkout = {
        sessions: {
          create: jest
            .fn()
            .mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/x' }),
        },
      } as any;
    };

    it('opens the 14-day trial the landing page sells when grantTrial (#913)', async () => {
      mockCheckout();

      await service.createCheckoutSession(checkoutParams(true));

      // Asserted on its own because the trial cannot be carried by the Price:
      // Stripe exposes no writable trial field there, so if this argument is
      // dropped, swapping STRIPE_PRICE_ID cannot restore it and every chapter
      // is charged on day zero while the site still advertises a free trial.
      expect(capturedSessionArgs().subscription_data).toEqual({
        trial_period_days: 14,
      });
    });

    it('omits the trial entirely when grantTrial is false', async () => {
      mockCheckout();

      await service.createCheckoutSession(checkoutParams(false));

      // Absent, not `trial_period_days: 0`. Omitting the key is the
      // unambiguous way to say "no trial", so a repeat checkout is an ordinary
      // immediate charge without depending on how Stripe treats a zero.
      expect(capturedSessionArgs()).not.toHaveProperty('subscription_data');
    });

    it('never sends customer_email, so Stripe cannot mint a second customer (#929)', async () => {
      // The regression guard for this issue's root cause. `customer` and
      // `customer_email` are mutually exclusive at Stripe, and an email always
      // creates a new Customer — which is how one chapter ended up with two
      // customer records and two live subscriptions.
      mockCheckout();

      await service.createCheckoutSession(checkoutParams(false));

      expect(capturedSessionArgs()).not.toHaveProperty('customer_email');
      expect(capturedSessionArgs()).toHaveProperty('customer', 'cus_existing');
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

  describe('createPaymentIntent', () => {
    it('should create a payment intent with automatic payment methods and map the result', async () => {
      const params = {
        amount: 5000,
        currency: 'usd',
        metadata: {
          invoice_id: 'inv_123',
          chapter_id: 'chap_123',
          user_id: 'user_123',
        },
        idempotencyKey: 'invoice-pay-inv_123-first',
      };

      stripeMock.paymentIntents = {
        create: jest.fn().mockResolvedValue({
          id: 'pi_123',
          status: 'requires_payment_method',
          client_secret: 'pi_123_secret_abc',
          latest_charge: null,
        }),
        retrieve: jest.fn(),
      } as any;

      const result = await service.createPaymentIntent(params);

      // The idempotency key rides in the request-options argument, not the body.
      expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
        {
          amount: params.amount,
          currency: params.currency,
          metadata: params.metadata,
          automatic_payment_methods: { enabled: true },
        },
        { idempotencyKey: 'invoice-pay-inv_123-first' },
      );
      expect(result).toEqual({
        id: 'pi_123',
        status: 'requires_payment_method',
        clientSecret: 'pi_123_secret_abc',
        latestChargeId: null,
      });
    });
  });

  describe('getPaymentIntent', () => {
    it('should retrieve a payment intent and keep a string latest_charge as-is', async () => {
      stripeMock.paymentIntents = {
        create: jest.fn(),
        retrieve: jest.fn().mockResolvedValue({
          id: 'pi_123',
          status: 'succeeded',
          client_secret: 'pi_123_secret_abc',
          latest_charge: 'ch_123',
        }),
      } as any;

      const result = await service.getPaymentIntent('pi_123');

      expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledWith('pi_123');
      expect(result).toEqual({
        id: 'pi_123',
        status: 'succeeded',
        clientSecret: 'pi_123_secret_abc',
        latestChargeId: 'ch_123',
      });
    });

    it('should map an expanded latest_charge object to its id', async () => {
      stripeMock.paymentIntents = {
        create: jest.fn(),
        retrieve: jest.fn().mockResolvedValue({
          id: 'pi_123',
          status: 'succeeded',
          client_secret: 'pi_123_secret_abc',
          latest_charge: { id: 'ch_456' },
        }),
      } as any;

      const result = await service.getPaymentIntent('pi_123');

      expect(result?.latestChargeId).toBe('ch_456');
    });

    it('should map a null latest_charge to null', async () => {
      stripeMock.paymentIntents = {
        create: jest.fn(),
        retrieve: jest.fn().mockResolvedValue({
          id: 'pi_123',
          status: 'requires_payment_method',
          client_secret: 'pi_123_secret_abc',
          latest_charge: null,
        }),
      } as any;

      const result = await service.getPaymentIntent('pi_123');

      expect(result?.latestChargeId).toBeNull();
    });

    it('should map a missing latest_charge to null', async () => {
      stripeMock.paymentIntents = {
        create: jest.fn(),
        retrieve: jest.fn().mockResolvedValue({
          id: 'pi_123',
          status: 'requires_payment_method',
          client_secret: 'pi_123_secret_abc',
        }),
      } as any;

      const result = await service.getPaymentIntent('pi_123');

      expect(result?.latestChargeId).toBeNull();
    });

    it('should return null when Stripe reports the intent as resource_missing', async () => {
      stripeMock.paymentIntents = {
        create: jest.fn(),
        retrieve: jest
          .fn()
          .mockRejectedValue(stripeInvalidRequestError('resource_missing')),
      } as any;

      // A permanently unknown id means "mint a fresh one", not an outage — so
      // the caller must not see a throw here.
      await expect(service.getPaymentIntent('pi_gone')).resolves.toBeNull();
    });

    it('should rethrow an invalid-request error that is not resource_missing', async () => {
      const error = stripeInvalidRequestError('parameter_invalid_empty');
      stripeMock.paymentIntents = {
        create: jest.fn(),
        retrieve: jest.fn().mockRejectedValue(error),
      } as any;

      await expect(service.getPaymentIntent('pi_123')).rejects.toBe(error);
    });

    it('should rethrow transport/API errors so callers can surface an outage', async () => {
      const error = new Error('connection reset');
      stripeMock.paymentIntents = {
        create: jest.fn(),
        retrieve: jest.fn().mockRejectedValue(error),
      } as any;

      await expect(service.getPaymentIntent('pi_123')).rejects.toBe(error);
    });
  });

  describe('cancelPaymentIntent', () => {
    it('should cancel the intent', async () => {
      stripeMock.paymentIntents = {
        cancel: jest.fn().mockResolvedValue({ id: 'pi_123' }),
      } as any;

      await service.cancelPaymentIntent('pi_123');

      expect(stripeMock.paymentIntents.cancel).toHaveBeenCalledWith('pi_123');
    });

    it('should warn about, but swallow, an invalid-request error (already terminal or unknown)', async () => {
      stripeMock.paymentIntents = {
        cancel: jest
          .fn()
          .mockRejectedValue(
            stripeInvalidRequestError('payment_intent_unexpected_state'),
          ),
      } as any;
      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => {});

      // Nothing left to cancel must not fail the caller's void transition.
      await expect(
        service.cancelPaymentIntent('pi_123'),
      ).resolves.toBeUndefined();

      // `payment_intent_unexpected_state` also covers an intent that is
      // `processing` — money in flight against an invoice being closed — so
      // silence here would hide a real reconciliation case.
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('pi_123'));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('payment_intent_unexpected_state'),
      );

      warnSpy.mockRestore();
    });

    it('should name the missing code in the warning when Stripe sends none', async () => {
      stripeMock.paymentIntents = {
        cancel: jest.fn().mockRejectedValue(stripeInvalidRequestError()),
      } as any;
      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => {});

      await expect(
        service.cancelPaymentIntent('pi_123'),
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('unknown code'),
      );

      warnSpy.mockRestore();
    });

    it('should rethrow non-invalid-request errors without warning', async () => {
      const error = new Error('connection reset');
      stripeMock.paymentIntents = {
        cancel: jest.fn().mockRejectedValue(error),
      } as any;
      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => {});

      await expect(service.cancelPaymentIntent('pi_123')).rejects.toBe(error);

      // A transport failure is not "nothing left to cancel" — it propagates to
      // the caller's best-effort handler instead of being logged away here.
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('chargeIdFromLatestCharge', () => {
    it('returns a string latest_charge unchanged', () => {
      expect(chargeIdFromLatestCharge('ch_123')).toBe('ch_123');
    });

    it('unwraps an expanded charge object to its id', () => {
      expect(chargeIdFromLatestCharge({ id: 'ch_456' })).toBe('ch_456');
    });

    it('maps null and undefined to null', () => {
      expect(chargeIdFromLatestCharge(null)).toBeNull();
      expect(chargeIdFromLatestCharge(undefined)).toBeNull();
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
