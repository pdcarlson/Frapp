import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { StripePriceConsistencyService } from './stripe-price-consistency.service';
import { StripePriceAccountMismatchError } from './stripe-price-consistency';

jest.mock('stripe');

const StripeCtor = Stripe as unknown as jest.Mock;

const REAL_SECRET = 'sk_test_consistency_gate_ok';
const PRICE_ID = 'price_1U93Pm3Dzz3XLCb6okJnzjat';

describe('StripePriceConsistencyService', () => {
  const retrieve = jest.fn();
  let warn: jest.SpyInstance;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    retrieve.mockReset();
    StripeCtor.mockReset();
    StripeCtor.mockImplementation(() => ({
      prices: { retrieve },
    }));
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function serviceWith(env: {
    secret?: string;
    priceId?: string;
  }): StripePriceConsistencyService {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'STRIPE_SECRET_KEY') return env.secret;
        if (key === 'STRIPE_PRICE_ID') return env.priceId;
        return undefined;
      }),
    } as unknown as ConfigService;
    return new StripePriceConsistencyService(config);
  }

  it('does not construct Stripe or retrieve when the secret is a placeholder', async () => {
    const service = serviceWith({
      secret: 'sk_test_ci_not_real',
      priceId: 'price_ci_not_real',
    });

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(StripeCtor).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('passes when the configured Price is active on this account', async () => {
    retrieve.mockResolvedValue({ id: PRICE_ID, active: true });
    const service = serviceWith({ secret: REAL_SECRET, priceId: PRICE_ID });

    await expect(service.assertConfiguredPrice()).resolves.toBeUndefined();
    expect(StripeCtor).toHaveBeenCalledWith(
      REAL_SECRET,
      expect.objectContaining({
        timeout: 8_000,
        maxNetworkRetries: 0,
      }),
    );
    expect(retrieve).toHaveBeenCalledWith(PRICE_ID);
  });

  it('refuses boot when the Price is missing on the secret key account', async () => {
    retrieve.mockRejectedValue({
      code: 'resource_missing',
      type: 'invalid_request_error',
      message: 'No such price',
      param: 'id',
    });
    const service = serviceWith({ secret: REAL_SECRET, priceId: PRICE_ID });

    await expect(service.onModuleInit()).rejects.toThrow(
      StripePriceAccountMismatchError,
    );
    expect(errorLog).toHaveBeenCalled();
  });

  it('refuses boot when the configured Price is inactive', async () => {
    retrieve.mockResolvedValue({ id: PRICE_ID, active: false });
    const service = serviceWith({ secret: REAL_SECRET, priceId: PRICE_ID });

    await expect(service.assertConfiguredPrice()).rejects.toBeInstanceOf(
      StripePriceAccountMismatchError,
    );
    expect(errorLog).toHaveBeenCalled();
  });

  it('does not refuse boot on a transient Stripe error', async () => {
    retrieve.mockRejectedValue({
      type: 'api_error',
      name: 'StripeConnectionError',
      message: 'stripe is unreachable',
    });
    const service = serviceWith({ secret: REAL_SECRET, priceId: PRICE_ID });

    await expect(service.assertConfiguredPrice()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
