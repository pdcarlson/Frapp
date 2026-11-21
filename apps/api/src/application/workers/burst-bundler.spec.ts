import { BurstBundler } from './burst-bundler';

describe('BurstBundler', () => {
  let now = 0;
  const clock = () => now;
  let bundler: BurstBundler;

  beforeEach(() => {
    now = 1_000_000;
    bundler = new BurstBundler({ threshold: 3, windowMs: 60_000, now: clock });
  });

  it('pushes the first two messages individually', () => {
    expect(bundler.record('a').action).toBe('push');
    now += 1_000;
    expect(bundler.record('a').action).toBe('push');
  });

  it('bundles on the third message in the window', () => {
    bundler.record('a');
    now += 1_000;
    bundler.record('a');
    now += 1_000;
    const decision = bundler.record('a');
    expect(decision.action).toBe('bundle');
    if (decision.action !== 'bundle') return;
    expect(decision.count).toBe(3);
  });

  it('skips additional messages after a bundle in the same window', () => {
    bundler.record('a');
    now += 1_000;
    bundler.record('a');
    now += 1_000;
    bundler.record('a');
    now += 1_000;
    expect(bundler.record('a').action).toBe('skip');
  });

  describe('a mention past the threshold (#4359)', () => {
    const toBundle = () => {
      bundler.record('a');
      bundler.record('a');
      expect(bundler.record('a').action).toBe('bundle');
    };

    it('pushes the first mention after the bundle', () => {
      toBundle();
      expect(bundler.record('a').action).toBe('skip');
      expect(bundler.record('a', true)).toEqual({ action: 'push', count: 5 });
    });

    it('pushes only one mention per window, so a run of pings stays capped', () => {
      toBundle();
      expect(bundler.record('a', true).action).toBe('push');
      for (let i = 0; i < 10; i++) {
        expect(bundler.record('a', true).action).toBe('skip');
      }
    });

    it('lets the next window push a mention again', () => {
      toBundle();
      bundler.record('a', true);
      now += 60_001;
      toBundle();
      expect(bundler.record('a', true).action).toBe('push');
    });

    it('changes nothing below the threshold', () => {
      expect(bundler.record('a', true)).toEqual({ action: 'push', count: 1 });
      expect(bundler.record('a', true)).toEqual({ action: 'push', count: 2 });
      expect(bundler.record('a', true).action).toBe('bundle');
    });
  });

  it('resets the window after the configured ms', () => {
    bundler.record('a');
    bundler.record('a');
    bundler.record('a');
    now += 60_001;
    expect(bundler.record('a').action).toBe('push');
  });

  it('treats distinct keys independently', () => {
    bundler.record('a');
    bundler.record('a');
    bundler.record('a');
    expect(bundler.record('b').action).toBe('push');
  });

  it('sweeps stale entries', () => {
    bundler.record('a');
    bundler.record('b');
    expect(bundler.size()).toBe(2);
    now += 120_000;
    bundler.sweep();
    expect(bundler.size()).toBe(0);
  });
});
