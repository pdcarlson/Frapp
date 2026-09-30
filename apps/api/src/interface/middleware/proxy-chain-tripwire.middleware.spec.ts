import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';
import { createProxyChainTripwire } from './proxy-chain-tripwire.middleware';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn() }));

describe('createProxyChainTripwire (#2972)', () => {
  const requestWith = (xff?: string) =>
    ({
      headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
      socket: { remoteAddress: '10.0.0.1' },
    }) as unknown as Request;

  const pass = (
    tripwire: ReturnType<typeof createProxyChainTripwire>,
    xff?: string,
  ) => {
    const next = jest.fn();
    tripwire(requestWith(xff), {} as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
  };

  beforeEach(() => {
    jest.mocked(Sentry.captureMessage).mockClear();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  // Production under staging's count: a caller that sends no chain arrives
  // with production's two appended entries, one short of three.
  it('reports a chain shorter than the hop count, and still serves the request', () => {
    const tripwire = createProxyChainTripwire(3);

    pass(tripwire, '198.51.100.5, 192.0.2.1');

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'trust proxy hop count exceeds the forwarded chain',
      expect.objectContaining({
        level: 'error',
        tags: { trust_proxy_hops: '3', xff_count: '2' },
      }),
    );
  });

  it('reports once per process, not once per request', () => {
    const tripwire = createProxyChainTripwire(3);

    pass(tripwire, '198.51.100.5');
    pass(tripwire, '198.51.100.6, 192.0.2.1');

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['exactly the hop count', '198.51.100.5, 192.0.2.1'],
    ['a forged prefix on top of it', '203.0.113.9, 198.51.100.5, 192.0.2.1'],
  ])('stays quiet for %s', (_label, xff) => {
    const tripwire = createProxyChainTripwire(2);

    pass(tripwire, xff);

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  // Render's health checker reaches the process with no chain at all; that
  // says nothing about the proxies in front of real traffic.
  it('ignores a request with no forwarded chain', () => {
    const tripwire = createProxyChainTripwire(2);

    pass(tripwire);

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('keeps serving when Sentry itself throws', () => {
    jest.mocked(Sentry.captureMessage).mockImplementationOnce(() => {
      throw new Error('transport down');
    });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const tripwire = createProxyChainTripwire(3);

    pass(tripwire, '198.51.100.5');
  });
});
