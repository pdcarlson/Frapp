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
