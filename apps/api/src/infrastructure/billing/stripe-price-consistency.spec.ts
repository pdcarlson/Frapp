import {
  shouldSkipStripePriceConsistency,
  isStripePriceMisconfigurationError,
  StripePriceAccountMismatchError,
  STRIPE_PRICE_ACCOUNT_MISMATCH_MESSAGE,
} from './stripe-price-consistency';

describe('shouldSkipStripePriceConsistency', () => {
  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['E2E dummy', 'sk_test_dummy'],
    ['CI docker', 'sk_test_ci_not_real'],
    ['cloud sandbox', 'sk_test_placeholder_cloud_sandbox'],
    ['OpenAPI export', 'placeholder_value'],
    ['unit-fixture secret', 'test_secret_key'],
  ])('skips %s', (_label, secret) => {
    expect(shouldSkipStripePriceConsistency(secret)).toBe(true);
  });

  it('asserts a real-looking sk_test_ secret (mocked billing tests cannot catch this)', () => {
    expect(
      shouldSkipStripePriceConsistency('sk_test_consistency_gate_ok'),
    ).toBe(false);
  });

  it('asserts a real-looking sk_live_ secret', () => {
    expect(
      shouldSkipStripePriceConsistency('sk_live_consistency_gate_ok'),
    ).toBe(false);
  });
});

describe('isStripePriceMisconfigurationError', () => {
  it('treats resource_missing as fail-closed', () => {
    expect(
      isStripePriceMisconfigurationError({ code: 'resource_missing' }),
    ).toBe(true);
  });

  it('treats authentication_error as fail-closed', () => {
    expect(
      isStripePriceMisconfigurationError({ type: 'authentication_error' }),
    ).toBe(true);
  });

  it('does not treat a connection/API blip as misconfiguration', () => {
    expect(
      isStripePriceMisconfigurationError({
        type: 'api_error',
        name: 'StripeConnectionError',
      }),
    ).toBe(false);
  });
});

describe('StripePriceAccountMismatchError', () => {
  it('names the key/price mismatch without including the secret', () => {
    const err = new StripePriceAccountMismatchError(
      'price_abc',
      'resource_missing: No such price',
    );
    expect(err.message).toContain(STRIPE_PRICE_ACCOUNT_MISMATCH_MESSAGE);
    expect(err.message).toContain('price_abc');
    expect(err.message).not.toMatch(/sk_(test|live)_/);
  });

  // `category` is what the public /health/ready body shows (#2999).
  describe('category', () => {
    it("is the error's own code when it has one", () => {
      const err = new StripePriceAccountMismatchError('price_x', 'inactive', {
        code: 'price_inactive',
      });
      expect(err.category).toBe('price_inactive');
    });

    it("is the Stripe error's code, never its message", () => {
      const err = new StripePriceAccountMismatchError('price_x', 'expired', {
        cause: Object.assign(
          new Error('Invalid API Key provided: sk_live_****abcd'),
          {
            code: 'api_key_expired',
            type: 'StripeAuthenticationError',
            rawType: 'authentication_error',
          },
        ),
      });
      expect(err.category).toBe('api_key_expired');
    });

    it("falls back to the Stripe API type, not stripe-node's class name", () => {
      const err = new StripePriceAccountMismatchError('price_x', 'denied', {
        cause: Object.assign(new Error('denied'), {
          type: 'StripeAuthenticationError',
          rawType: 'authentication_error',
        }),
      });
      expect(err.category).toBe('authentication_error');
    });

    it('is `misconfigured` when nothing names the fault in a known shape', () => {
      expect(
        new StripePriceAccountMismatchError('price_x', 'odd', {
          cause: Object.assign(new Error('x'), { code: 'Free text: sk_live' }),
        }).category,
      ).toBe('misconfigured');
      expect(
        new StripePriceAccountMismatchError('price_x', 'no cause').category,
      ).toBe('misconfigured');
    });
  });
});

describe('isStripePriceMisconfigurationError — stripe-node error shapes', () => {
  it('classifies a 401 as misconfiguration via rawType, not as a transient blip', () => {
    // stripe-node keeps the API's own type on `rawType`; `type` carries a class
    // name. Reading only `type` meant a rotated STRIPE_SECRET_KEY was called
    // transient by both boot guards — "not refusing boot", deploy green, every
    // Stripe call 401ing at runtime.
    expect(
      isStripePriceMisconfigurationError({
        type: 'StripeAPIError',
        rawType: 'authentication_error',
        message: 'Invalid API Key provided',
      }),
    ).toBe(true);
  });

  it('classifies a 403 permission error as misconfiguration', () => {
    expect(
      isStripePriceMisconfigurationError({
        type: 'StripeAPIError',
        rawType: 'invalid_request_error',
      }),
    ).toBe(true);
  });

  it('still treats a genuine network blip as transient', () => {
    expect(isStripePriceMisconfigurationError(new Error('ETIMEDOUT'))).toBe(
      false,
    );
    expect(
      isStripePriceMisconfigurationError({ type: 'StripeConnectionError' }),
    ).toBe(false);
  });
});
