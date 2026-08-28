import { AuthFailureSpikeDetector } from './auth-failure-spike';

/**
 * The detector approximates "20+ auth failures from one origin in 5 minutes".
 * Time is injected on every call, so these assertions pin the window
 * arithmetic exactly rather than around a real clock.
 */
describe('AuthFailureSpikeDetector', () => {
  const T0 = 1_700_000_000_000;

  function detector(overrides = {}) {
    return new AuthFailureSpikeDetector({
      threshold: 5,
      windowMs: 60_000,
      cooldownMs: 300_000,
      ...overrides,
    });
  }

  it('stays quiet below the threshold', () => {
    const d = detector();
    for (let i = 0; i < 4; i++) {
      expect(d.record('origin-a', T0 + i * 1_000)).toBeNull();
    }
  });

  it('trips exactly on the failure that reaches the threshold', () => {
    const d = detector();
    for (let i = 0; i < 4; i++) d.record('origin-a', T0 + i * 1_000);

    const trip = d.record('origin-a', T0 + 4_000);
    expect(trip).toEqual({ count: 5, windowMs: 60_000, threshold: 5 });
  });

  it('does not trip when the failures fall outside one window', () => {
    const d = detector();
    // Five failures, but spread 30s apart across 2 minutes: never five inside
    // any single 60s window.
    for (let i = 0; i < 4; i++) {
      expect(d.record('origin-a', T0 + i * 30_000)).toBeNull();
    }
    expect(d.record('origin-a', T0 + 4 * 30_000)).toBeNull();
  });

  it('counts origins independently', () => {
    const d = detector();
    for (let i = 0; i < 4; i++) {
      d.record('origin-a', T0 + i);
      d.record('origin-b', T0 + i);
    }
    expect(d.record('origin-a', T0 + 5)).not.toBeNull();
    // origin-b is at 4 and unaffected by origin-a tripping.
    expect(d.record('origin-b', T0 + 5)).not.toBeNull();
  });

  it('emits once per sustained attack, not once per request', () => {
    const d = detector();
    for (let i = 0; i < 5; i++) d.record('origin-a', T0 + i);

    // Another full threshold's worth, still inside the cooldown.
    let trips = 0;
    for (let i = 0; i < 50; i++) {
      if (d.record('origin-a', T0 + 1_000 + i)) trips++;
    }
    expect(trips).toBe(0);
  });

  it('can trip again once the cooldown has elapsed', () => {
    const d = detector();
    for (let i = 0; i < 5; i++) d.record('origin-a', T0 + i);

    const afterCooldown = T0 + 300_001;
    for (let i = 0; i < 4; i++) d.record('origin-a', afterCooldown + i);
    expect(d.record('origin-a', afterCooldown + 5)).not.toBeNull();
  });

  it('bounds memory when an attacker rotates origins', () => {
    const d = detector({ maxTrackedOrigins: 50 });
    for (let i = 0; i < 5_000; i++) {
      d.record(`origin-${i}`, T0 + i);
    }
    expect(d.size()).toBeLessThanOrEqual(50);
  });

  it('keeps a steady origin alive through churn it can outlast', () => {
    const d = detector({ maxTrackedOrigins: 200 });
    for (let i = 0; i < 4; i++) {
      d.record('attacker', T0 + i * 100);
      for (let j = 0; j < 20; j++) {
        d.record(`noise-${i}-${j}`, T0 + i * 100 + j);
      }
    }
    expect(d.record('attacker', T0 + 500)).not.toBeNull();
  });

  /**
   * Documents a real limit rather than asserting it away: the origin map is
   * bounded, so an attacker who can emit more than `maxTrackedOrigins` distinct
   * origins inside one window evicts their own counter before it fills and
   * never trips the rule. This is inherent to counting in bounded memory — the
   * Sentry-side rule (human action, see the module docstring) is the layer that
   * does not have it. The default cap of 10,000 makes the required churn
   * expensive, not impossible.
   */
  it('can be evaded by rotating more origins than the cap holds', () => {
    const d = detector({ maxTrackedOrigins: 10 });
    let trips = 0;
    for (let round = 0; round < 4; round++) {
      d.record('attacker', T0 + round * 100);
      for (let j = 0; j < 20; j++) {
        if (d.record(`noise-${round}-${j}`, T0 + round * 100 + j)) trips++;
      }
    }
    expect(d.record('attacker', T0 + 500)).toBeNull();
    expect(trips).toBe(0);
  });
});
