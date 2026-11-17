import { FailedLookupLimiter } from './failed-lookup-limiter';

describe('FailedLookupLimiter', () => {
  const T0 = 1_800_000_000_000;

  it('allows an address until it has `limit` misses in the window', () => {
    const limiter = new FailedLookupLimiter(3, 60_000, 100);
    limiter.recordMiss('a', T0);
    limiter.recordMiss('a', T0 + 1);
    expect(limiter.retryAfterSeconds('a', T0 + 2)).toBe(0);
    limiter.recordMiss('a', T0 + 2);
    expect(limiter.retryAfterSeconds('a', T0 + 10_000)).toBe(50);
  });

  it('counts each address on its own', () => {
    const limiter = new FailedLookupLimiter(1, 60_000, 100);
    limiter.recordMiss('a', T0);
    expect(limiter.retryAfterSeconds('a', T0)).toBe(60);
    expect(limiter.retryAfterSeconds('b', T0)).toBe(0);
  });

  it('starts a fresh window once the last one is over', () => {
    const limiter = new FailedLookupLimiter(1, 60_000, 100);
    limiter.recordMiss('a', T0);
    expect(limiter.retryAfterSeconds('a', T0 + 60_000)).toBe(0);
    limiter.recordMiss('a', T0 + 60_000);
    expect(limiter.retryAfterSeconds('a', T0 + 60_001)).toBe(60);
  });

  it('never says to retry in under a second', () => {
    const limiter = new FailedLookupLimiter(1, 60_000, 100);
    limiter.recordMiss('a', T0);
    expect(limiter.retryAfterSeconds('a', T0 + 59_999)).toBe(1);
  });

  it('holds at most `maxAddresses`, dropping the one seen longest ago', () => {
    const limiter = new FailedLookupLimiter(1, 60_000, 2);
    limiter.recordMiss('a', T0);
    limiter.recordMiss('b', T0);
    limiter.recordMiss('c', T0);
    expect(limiter.retryAfterSeconds('a', T0)).toBe(0);
    expect(limiter.retryAfterSeconds('b', T0)).toBe(60);
    expect(limiter.retryAfterSeconds('c', T0)).toBe(60);
  });
});
