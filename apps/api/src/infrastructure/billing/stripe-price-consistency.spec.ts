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
});
