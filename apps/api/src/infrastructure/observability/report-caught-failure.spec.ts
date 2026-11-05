import * as Sentry from '@sentry/nestjs';
import { SupabaseQueryError } from '../supabase/supabase-query-error';
import {
  CAUGHT_FAILURE_REPORT_INTERVAL_MS,
  reportCaughtFailure,
} from './report-caught-failure';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(() => 'event-exception'),
  captureMessage: jest.fn(() => 'event-message'),
}));

const captureException = jest.mocked(Sentry.captureException);
const captureMessage = jest.mocked(Sentry.captureMessage);

function logger() {
  return { error: jest.fn(), warn: jest.fn() };
}

describe('reportCaughtFailure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs the site message and reports the error grouped by site, not stack', () => {
    const log = logger();
    reportCaughtFailure(log, {
      level: 'error',
      site: 'poll-list-vote-totals',
      message: 'Vote totals failed for chapter 1234',
      error: new TypeError('fetch failed'),
      tags: { sweep: 'poll-expiry' },
    });

    expect(log.error).toHaveBeenCalledTimes(1);
    expect(String(log.error.mock.calls[0]?.[0])).toBe(
      'Vote totals failed for chapter 1234: fetch failed',
    );
    expect(captureException).toHaveBeenCalledTimes(1);
    const [reported, context] = captureException.mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    expect(reported.message).toBe('fetch failed');
    expect(context).toEqual({
      level: 'error',
      tags: { sweep: 'poll-expiry', caught_at: 'poll-list-vote-totals' },
      fingerprint: ['caught-failure', 'poll-list-vote-totals', 'TypeError'],
    });
  });

  it('never sends the site message, which may carry ids', () => {
    reportCaughtFailure(logger(), {
      level: 'warning',
      site: 'task-sweep-task',
      message: 'Task 9f1c… for member@example.com failed',
      error: new Error('boom'),
    });

    expect(JSON.stringify(captureException.mock.calls)).not.toContain(
      'member@example.com',
    );
  });

  it('keys the fingerprint by the query error code so two faults are two issues', () => {
    reportCaughtFailure(logger(), {
      level: 'error',
      site: 'scheduled-dispatch-claim',
      message: 'claim failed',
      error: new SupabaseQueryError({
        code: '57014',
        message: 'canceling statement due to statement timeout',
      }),
    });

    expect(captureException.mock.calls[0]?.[1]).toMatchObject({
      fingerprint: [
        'caught-failure',
        'scheduled-dispatch-claim',
        'SupabaseQueryError:57014',
      ],
    });
  });

  it('logs at warn and reports at warning for a warning site', () => {
    const log = logger();
    reportCaughtFailure(log, {
      level: 'warning',
      site: 'invoice-sweep-invoice',
      message: 'Invoice overdue mark failed',
      error: new Error('boom'),
    });

    expect(log.warn).toHaveBeenCalledWith('Invoice overdue mark failed: boom');
    expect(log.error).not.toHaveBeenCalled();
    expect(captureException.mock.calls[0]?.[1]).toMatchObject({
      level: 'warning',
    });
  });

  it('reports a failure with nothing thrown as a fixed message', () => {
    const log = logger();
    reportCaughtFailure(log, {
      level: 'error',
      site: 'billing-checkout-second-customer',
      message: 'Chapter abc has a second Stripe customer cus_123',
    });

    expect(log.error).toHaveBeenCalledWith(
      'Chapter abc has a second Stripe customer cus_123',
    );
    expect(captureException).not.toHaveBeenCalled();
    expect(captureMessage).toHaveBeenCalledWith(
      'caught failure: billing-checkout-second-customer',
      {
        level: 'error',
        tags: { caught_at: 'billing-checkout-second-customer' },
        fingerprint: ['caught-failure', 'billing-checkout-second-customer'],
      },
    );
  });

  it('reports one site once per window, and logs every time', () => {
    const log = logger();
    const failure = {
      level: 'error' as const,
      site: 'discord-import-sweep-tick',
      message: 'tick failed',
      error: new Error('db down'),
    };

    reportCaughtFailure(log, failure, 1_000);
    reportCaughtFailure(log, failure, 2_000);
    reportCaughtFailure(
      log,
      failure,
      1_000 + CAUGHT_FAILURE_REPORT_INTERVAL_MS - 1,
    );
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledTimes(3);

    reportCaughtFailure(
      log,
      failure,
      1_000 + CAUGHT_FAILURE_REPORT_INTERVAL_MS,
    );
    expect(captureException).toHaveBeenCalledTimes(2);
  });

  it('throttles each site on its own', () => {
    const base = {
      level: 'error' as const,
      message: 'm',
      error: new Error('x'),
    };
    reportCaughtFailure(logger(), { ...base, site: 'a-site' }, 0);
    reportCaughtFailure(logger(), { ...base, site: 'b-site' }, 0);
    reportCaughtFailure(logger(), { ...base, site: 'a-site:invoice' }, 0);

    expect(captureException).toHaveBeenCalledTimes(3);
  });

  it('logs but does not report an invalid site id', () => {
    const log = logger();
    reportCaughtFailure(log, {
      level: 'error',
      site: 'Chapter 1234 failed',
      message: 'm',
      error: new Error('x'),
    });

    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('invalid site id'),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it('never throws when Sentry does', () => {
    captureException.mockImplementationOnce(() => {
      throw new Error('transport down');
    });
    const log = logger();

    expect(() =>
      reportCaughtFailure(log, {
        level: 'error',
        site: 'search-source-late-failure',
        message: 'm',
        error: new Error('x'),
      }),
    ).not.toThrow();
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Sentry report failed for caught failure search-source-late-failure',
      ),
    );
  });
});
