import {
  BadGatewayException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { ErrorEvent } from '@sentry/nestjs';
import Stripe from 'stripe';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { buildSentryOptions } from '../../infrastructure/observability/sentry-options';
import { toReportableError } from '../../infrastructure/observability/reportable-error';

/**
 * What `AllExceptionsFilter` ships for a rethrown 5xx, through the **real**
 * SDK and production's `beforeSend` (#2131).
 *
 * `all-exceptions.filter.spec.ts` mocks `@sentry/nestjs`, so it can prove the
 * filter *asks* for a fingerprint, not that one reaches the transport intact
 * past the scrubber, nor that it splits the faults Sentry's own grouping would
 * merge. The construction follows `sentry-integration.spec.ts`: production
 * options, a stub transport, and only the integrations the assertions need.
 */
const FIXTURE_DSN = 'https://fixturekey@o0.ingest.example.invalid/1';

describe('AllExceptionsFilter → Sentry, for a rethrown 5xx (#2131)', () => {
  let sent: ErrorEvent[] = [];
  let bodies: unknown[] = [];

  beforeAll(() => {
    Sentry.init({
      ...buildSentryOptions(FIXTURE_DSN),
      defaultIntegrations: false,
      integrations: [Sentry.linkedErrorsIntegration()],
      transport: () => ({
        send: (envelope: unknown) => {
          const items = Array.isArray(envelope) ? envelope[1] : undefined;
          for (const [headers, payload] of (items ?? []) as [
            { type?: string },
            ErrorEvent,
          ][]) {
            if (headers?.type === 'event') sent.push(payload);
          }
          return Promise.resolve({ statusCode: 200 });
        },
        flush: () => Promise.resolve(true),
      }),
    });
  });

  beforeEach(() => {
    sent = [];
    bodies = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await Sentry.close(2000);
  });

  function report(exception: unknown): void {
    const request = {
      requestId: 'req-2131',
      method: 'POST',
      url: '/v1/billing/checkout',
      ips: [],
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({
          status: () => ({
            json: (body: unknown) => {
              bodies.push(body);
            },
          }),
        }),
      }),
    } as unknown as ArgumentsHost;
    new AllExceptionsFilter().catch(exception, host);
  }

  const checkout = (cause: Error) =>
    new ServiceUnavailableException(
      'Billing service is temporarily unavailable',
      { cause: toReportableError(cause) },
    );
  const badPrice = (id: string) =>
    new Stripe.errors.StripeInvalidRequestError({
      message: `No such price: '${id}'`,
      code: 'resource_missing',
    });

  it('splits two Stripe faults at one site, and keeps one fault in one issue', async () => {
    report(checkout(badPrice('price_1')));
    report(
      checkout(
        new Stripe.errors.StripeConnectionError({
          message: 'connect ETIMEDOUT',
        }),
      ),
    );
    report(checkout(badPrice('price_2')));
    await Sentry.flush(2000);

    expect(sent).toHaveLength(3);
    // Same types and the same throw site: without the fingerprint these three
    // are one issue, because Sentry reads the message only when no stack does.
    for (const event of sent) {
      expect(event.exception?.values?.map((value) => value.type)).toEqual([
        'Error',
        'ServiceUnavailableException',
      ]);
    }
    const [first, timeout, second] = sent.map((event) => event.fingerprint);
    // Survives the scrubber's sweep intact.
    expect(first).toEqual([
      '{{ default }}',
      'ServiceUnavailableException',
      'StripeInvalidRequestError:resource_missing',
    ]);
    expect(timeout).toEqual([
      '{{ default }}',
      'ServiceUnavailableException',
      'StripeConnectionError',
    ]);
    expect(second).toEqual(first);

    // And the client saw none of it.
    for (const body of bodies) {
      expect(body).toEqual({
        statusCode: 503,
        error: 'SERVICE_UNAVAILABLE',
        message: 'Billing service is temporarily unavailable',
        requestId: 'req-2131',
      });
    }
  });

  it('splits two PostgREST faults normalized at one site by their codes', async () => {
    const purge = (code: string) =>
      new BadGatewayException(
        'Stored file cleanup did not complete; no account data was changed. Please retry.',
        {
          cause: toReportableError({
            code,
            message: 'lookup failed',
            details: 'Key (user_id)=(1)',
          }),
        },
      );
    report(purge('PGRST301'));
    report(purge('42P01'));
    await Sentry.flush(2000);

    expect(sent.map((event) => event.fingerprint)).toEqual([
      ['{{ default }}', 'BadGatewayException', 'NonErrorThrowable:PGRST301'],
      ['{{ default }}', 'BadGatewayException', 'NonErrorThrowable:42P01'],
    ]);
  });

  it('leaves an ordinary 500 on default grouping', async () => {
    report(new Error('boom'));
    await Sentry.flush(2000);

    expect(sent).toHaveLength(1);
    expect(sent[0].fingerprint).toBeUndefined();
  });
});
