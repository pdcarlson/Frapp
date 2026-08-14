/**
 * Auth-failure spike detection (issue #846, work-plan item 3).
 *
 * The work plan offered two ways to approximate "20+ auth failures from one
 * origin in 5 minutes" and said to pick the simpler and document the choice.
 *
 * **Chosen: the API-side counter.** The Sentry-side alternative is not
 * reachable by any agent — Sentry's issue-alert-rule API answers
 * `HTTP 410 {"message":"This API no longer exists."}`, so a rule can only be
 * created by a human in the dashboard. A counter here is code: it ships, it is
 * unit-tested, and it works the moment a DSN exists. The Sentry-side rule
 * remains worth adding as a second layer (tracked separately as a human
 * action), because this one has two limits a server-side rule does not:
 *
 *  1. **In-memory, so per-instance.** Two API instances each see half the
 *     traffic and each count half the failures. On a single Render instance
 *     that is exact; past that it under-reports, never over-reports.
 *  2. **Lost on restart.** A deploy resets every window.
 *  3. **Evadable by origin churn.** The origin map is bounded (see
 *     `maxTrackedOrigins`), so an attacker who emits more distinct origins than
 *     the cap holds within one window evicts their own counter before it fills.
 *     Bounding the map is not optional — an unbounded one turns this into the
 *     denial of service it exists to report — so this is the cost of counting
 *     in memory at all, not a bug to fix here. Pinned by a test.
 *
 * All three are acceptable for a *spike* signal, whose job is to notice a burst
 * in progress rather than to be an audit ledger. None is acceptable for
 * anything that must be complete — do not grow this into one. The Sentry-side
 * rule is the layer without these limits, which is why it stays on the human
 * action list rather than being considered redundant with this.
 */

export interface AuthFailureSpikeOptions {
  /** Failures within the window that trip the alert. */
  threshold?: number;
  /** Sliding window width, milliseconds. */
  windowMs?: number;
  /** Silence after a trip, so one sustained attack emits once, not thousands. */
  cooldownMs?: number;
  /**
   * Hard cap on tracked origins. An attacker rotating origins would otherwise
   * grow this map without bound — the detector would become the denial of
   * service it exists to report.
   */
  maxTrackedOrigins?: number;
}

interface OriginState {
  /** Failure timestamps inside the current window, ascending. */
  hits: number[];
  /** When the last alert fired, or 0. */
  alertedAt: number;
}

export const DEFAULT_SPIKE_THRESHOLD = 20;
export const DEFAULT_SPIKE_WINDOW_MS = 5 * 60_000;
export const DEFAULT_SPIKE_COOLDOWN_MS = 15 * 60_000;
export const DEFAULT_MAX_TRACKED_ORIGINS = 10_000;

export interface SpikeTrip {
  /** Failures counted in the window at the moment it tripped. */
  count: number;
  windowMs: number;
  threshold: number;
}

export class AuthFailureSpikeDetector {
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly maxTrackedOrigins: number;
  private readonly origins = new Map<string, OriginState>();

  constructor(options: AuthFailureSpikeOptions = {}) {
    this.threshold = options.threshold ?? DEFAULT_SPIKE_THRESHOLD;
    this.windowMs = options.windowMs ?? DEFAULT_SPIKE_WINDOW_MS;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_SPIKE_COOLDOWN_MS;
    this.maxTrackedOrigins =
      options.maxTrackedOrigins ?? DEFAULT_MAX_TRACKED_ORIGINS;
  }

  /**
   * Record one auth failure for `originKey`.
   *
   * Returns a {@link SpikeTrip} on the request that crosses the threshold, and
   * `null` otherwise — including for every failure during the cooldown that
   * follows a trip. Callers treat a non-null return as "emit the alert now".
   *
   * `now` is injected rather than read from the clock so the window arithmetic
   * is testable without timer mocking.
   */
  record(originKey: string, now: number = Date.now()): SpikeTrip | null {
    const state = this.origins.get(originKey) ?? { hits: [], alertedAt: 0 };

    const cutoff = now - this.windowMs;
    // Timestamps arrive ascending, so the survivors are always a suffix.
    const firstLive = state.hits.findIndex((at) => at > cutoff);
    state.hits = firstLive === -1 ? [] : state.hits.slice(firstLive);
    state.hits.push(now);

    this.origins.delete(originKey);
    this.origins.set(originKey, state);
    this.evictIfNeeded(cutoff);

    if (state.hits.length < this.threshold) return null;
    if (state.alertedAt && now - state.alertedAt < this.cooldownMs) return null;

    state.alertedAt = now;
    // Start the next window clean: without this the window stays saturated for
    // its full width after a trip, and the cooldown would be the only thing
    // preventing a re-alert on the very next failure.
    const count = state.hits.length;
    state.hits = [];
    return { count, windowMs: this.windowMs, threshold: this.threshold };
  }

  /** Tracked-origin count. Exposed for tests and diagnostics. */
  size(): number {
    return this.origins.size;
  }

  /**
   * Keep the map bounded. Drop origins with nothing left inside the window
   * first; if that is not enough, drop least-recently-touched entries — `Map`
   * iterates in insertion order and `record` re-inserts on every touch, so the
   * head of the iteration is the coldest.
   */
  private evictIfNeeded(cutoff: number): void {
    if (this.origins.size <= this.maxTrackedOrigins) return;

    for (const [key, state] of this.origins) {
      const newest = state.hits[state.hits.length - 1];
      if (newest === undefined || newest <= cutoff) {
        this.origins.delete(key);
      }
    }

    while (this.origins.size > this.maxTrackedOrigins) {
      const coldest = this.origins.keys().next();
      if (coldest.done) break;
      this.origins.delete(coldest.value);
    }
  }
}
