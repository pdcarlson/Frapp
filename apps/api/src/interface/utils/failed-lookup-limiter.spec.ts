import { FailedLookupLimiter } from './failed-lookup-limiter';

describe('FailedLookupLimiter', () => {
  const T0 = 1_800_000_000_000;

  const limiter = (
    overrides: Partial<
      ConstructorParameters<typeof FailedLookupLimiter>[0]
    > = {},
  ) =>
    new FailedLookupLimiter({
      limit: 3,
      windowMs: 60_000,
      maxAddresses: 100,
      rememberHitsMs: 3_600_000,
      maxRememberedHits: 100,
      ...overrides,
    });

  /** One whole lookup: reserve, then settle as `outcome`. */
  const lookup = (
    l: FailedLookupLimiter,
    address: string,
    credential: string,
    outcome: 'found' | 'missed' | 'failed',
    now: number,
  ): number => {
    const wait = l.reserve(address, credential, now);
    if (wait === 0) l.settle(address, credential, outcome, now);
    return wait;
  };

  it('allows an address until it has `limit` misses in the window', () => {
    const l = limiter();
    lookup(l, 'a', 't1', 'missed', T0);
    lookup(l, 'a', 't2', 'missed', T0 + 1);
    expect(lookup(l, 'a', 't3', 'missed', T0 + 2)).toBe(0);
    expect(l.reserve('a', 't4', T0 + 10_000)).toBe(50);
  });

  it('counts lookups in flight against the allowance', () => {
    const l = limiter();
    expect(l.reserve('a', 't1', T0)).toBe(0);
    expect(l.reserve('a', 't2', T0)).toBe(0);
    expect(l.reserve('a', 't3', T0)).toBe(0);
    expect(l.reserve('a', 't4', T0)).toBeGreaterThan(0);
    // One found its link: its place is free again.
    l.settle('a', 't1', 'found', T0);
    expect(l.reserve('a', 't5', T0)).toBe(0);
  });

  it('never counts a lookup that found something, or one that failed', () => {
    const l = limiter();
    for (let i = 0; i < 10; i += 1) {
      expect(lookup(l, 'a', `t${i}`, i % 2 ? 'found' : 'failed', T0)).toBe(0);
    }
  });

  it('counts each address on its own', () => {
    const l = limiter({ limit: 1 });
    lookup(l, 'a', 't1', 'missed', T0);
    expect(l.reserve('a', 't2', T0)).toBe(60);
    expect(l.reserve('b', 't2', T0)).toBe(0);
  });

  it('starts a fresh window once the last one is over', () => {
    const l = limiter({ limit: 1 });
    lookup(l, 'a', 't1', 'missed', T0);
    expect(lookup(l, 'a', 't2', 'missed', T0 + 60_000)).toBe(0);
    expect(l.reserve('a', 't3', T0 + 60_001)).toBe(60);
  });

  it('never says to retry in under a second', () => {
    const l = limiter({ limit: 1 });
    lookup(l, 'a', 't1', 'missed', T0);
    expect(l.reserve('a', 't2', T0 + 59_999)).toBe(1);
  });

  it('lets a credential that found something through an address over its allowance, for a while', () => {
    const l = limiter({ limit: 1, rememberHitsMs: 120_000 });
    lookup(l, 'a', 'live', 'found', T0);
    lookup(l, 'a', 'dead', 'missed', T0);
    expect(l.reserve('a', 'other', T0)).toBe(60);
    expect(lookup(l, 'a', 'live', 'found', T0 + 1)).toBe(0);
    // Remembered from its last hit, at T0 + 1, for two minutes.
    lookup(l, 'a', 'dead', 'missed', T0 + 120_000);
    expect(l.reserve('a', 'live', T0 + 120_002)).toBeGreaterThan(0);
  });

  it('forgets a credential once it misses', () => {
    const l = limiter({ limit: 1 });
    lookup(l, 'a', 'gone', 'found', T0);
    lookup(l, 'a', 'gone', 'missed', T0);
    expect(l.reserve('a', 'gone', T0)).toBe(60);
  });

  it('holds at most `maxAddresses`, dropping the one added longest ago', () => {
    const l = limiter({ limit: 1, maxAddresses: 2 });
    lookup(l, 'a', 't', 'missed', T0);
    lookup(l, 'b', 't', 'missed', T0);
    lookup(l, 'c', 't', 'missed', T0);
    expect(l.reserve('b', 't2', T0)).toBe(60);
    expect(l.reserve('c', 't2', T0)).toBe(60);
    expect(l.reserve('a', 't2', T0)).toBe(0);
  });

  it('holds at most `maxRememberedHits` credentials', () => {
    const l = limiter({ limit: 1, maxRememberedHits: 1 });
    lookup(l, 'a', 'first', 'found', T0);
    lookup(l, 'a', 'second', 'found', T0);
    lookup(l, 'a', 'dead', 'missed', T0);
    expect(l.reserve('a', 'first', T0)).toBe(60);
    expect(l.reserve('a', 'second', T0)).toBe(0);
  });
});
