import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { errorFingerprint } from './error-fingerprint';
import { toReportableError } from './reportable-error';
import { StripePriceAccountMismatchError } from '../billing/stripe-price-consistency';

function rethrown(cause: unknown): ServiceUnavailableException {
  return new ServiceUnavailableException(
    'Billing service is temporarily unavailable',
    { cause: toReportableError(cause) },
  );
}

describe('errorFingerprint (#2131)', () => {
  it("names a real Stripe cause by its class, since the SDK leaves `name` as 'Error'", () => {
    const badPrice = new Stripe.errors.StripeInvalidRequestError({
      message: "No such price: 'price_1'",
      code: 'resource_missing',
    });
    // The premise, pinned: if the SDK starts setting `name`, the type alone
    // would split these and this file should say so.
    expect(badPrice.name).toBe('Error');

    expect(errorFingerprint(rethrown(badPrice))).toEqual([
      '{{ default }}',
      'ServiceUnavailableException',
      'StripeInvalidRequestError:resource_missing',
    ]);
  });

  it('keeps two faults at one site apart, and one fault together', () => {
    const fingerprintOf = (cause: Error) => errorFingerprint(rethrown(cause));
    const badPrice = (id: string) =>
      new Stripe.errors.StripeInvalidRequestError({
        message: `No such price: '${id}'`,
        code: 'resource_missing',
      });
    const timeout = new Stripe.errors.StripeConnectionError({
      message: 'connect ETIMEDOUT',
    });

    expect(fingerprintOf(badPrice('p_1'))).not.toEqual(fingerprintOf(timeout));
    // The id is in the message, not the fingerprint, so it stays one issue.
    expect(fingerprintOf(badPrice('p_1'))).toEqual(
      fingerprintOf(badPrice('p_2')),
    );
  });

  it('keys a normalized PostgREST object on its code, never its message', () => {
    const lookup = (code: string) =>
      errorFingerprint(
        new BadGatewayException('Stored file cleanup did not complete', {
          cause: toReportableError({
            code,
            message: 'row for member@example.com',
            details: 'Key (email)=(member@example.com)',
          }),
        }),
      );

    expect(lookup('PGRST301')).toEqual([
      '{{ default }}',
      'BadGatewayException',
      'NonErrorThrowable:PGRST301',
    ]);
    expect(lookup('42P01')).not.toEqual(lookup('PGRST301'));
    expect(JSON.stringify(lookup('PGRST301'))).not.toContain('example.com');
  });

  it("splits the readiness check's Stripe misconfigurations, which share one throw site", () => {
    // health.controller.ts reports StripePriceAccountMismatchError as the
    // 503's cause; every variant is built in one method.
    const readiness = (mismatch: StripePriceAccountMismatchError) =>
      errorFingerprint(
        new ServiceUnavailableException(
          { code: 'DEGRADED', message: 'billing degraded' },
          { cause: toReportableError(mismatch) },
        ),
      );
    const fromStripe = (error: Error) =>
      new StripePriceAccountMismatchError('price_1', 'rejected', {
        cause: toReportableError(error),
      });

    const missingPrice = readiness(
      fromStripe(
        new Stripe.errors.StripeInvalidRequestError({
          message: 'No such price',
          code: 'resource_missing',
        }),
      ),
    );
    const revokedKey = readiness(
      fromStripe(
        new Stripe.errors.StripeAuthenticationError({
          message: 'Invalid API Key provided',
        }),
      ),
    );
    const inactive = readiness(
      new StripePriceAccountMismatchError('price_1', 'inactive', {
        code: 'price_inactive',
      }),
    );
    const empty = readiness(
      new StripePriceAccountMismatchError('(empty)', 'empty', {
        code: 'price_id_empty',
      }),
    );

    expect(missingPrice).toEqual([
      '{{ default }}',
      'ServiceUnavailableException',
      'StripePriceAccountMismatchError',
      'StripeInvalidRequestError:resource_missing',
    ]);
    expect(
      new Set([missingPrice, revokedKey, inactive, empty].map(String)).size,
    ).toBe(4);
  });

  it('fingerprints a bare non-Error throw, whose stack is always the normalizer', () => {
    expect(
      errorFingerprint(
        toReportableError({ code: 'PGRST205', message: 'no table' }),
      ),
    ).toEqual(['{{ default }}', 'NonErrorThrowable:PGRST205']);
  });

  it('leaves an ordinary error, and a chain with a non-Error cause, to default grouping', () => {
    expect(errorFingerprint(new Error('boom'))).toBeUndefined();
    expect(
      errorFingerprint(new ServiceUnavailableException('x')),
    ).toBeUndefined();
    // LinkedErrors skips a non-Error cause, so there is no chain to key.
    expect(
      errorFingerprint(
        new ServiceUnavailableException('x', { cause: { code: 'E1' } }),
      ),
    ).toBeUndefined();
  });

  it('reads only identifier-shaped tokens, so free text never becomes a key', () => {
    const cause = Object.assign(new Error('x'), {
      name: 'has spaces in it',
      code: 'member@example.com',
    });
    expect(
      errorFingerprint(new ServiceUnavailableException('x', { cause })),
    ).toEqual(['{{ default }}', 'ServiceUnavailableException', 'Error']);
  });

  it('stops walking a pathological chain', () => {
    let error: Error = new Error('root');
    for (let i = 0; i < 10; i += 1) {
      error = new ServiceUnavailableException(`level ${i}`, { cause: error });
    }
    expect(errorFingerprint(error)).toHaveLength(1 + 4);
  });
});
