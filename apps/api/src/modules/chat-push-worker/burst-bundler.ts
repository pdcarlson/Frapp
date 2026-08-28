/**
 * Burst bundler for chat push notifications (Chunk 05).
 *
 * Master plan: 3+ messages from the same sender within 60 seconds collapse
 * into a single "N new messages from X" push instead of spamming the
 * recipient with three separate notifications. Pure logic with an
 * injectable clock so tests are deterministic.
 *
 * Per-key state:
 *   key = `${senderId}:${channelId}:${recipientId}`
 *   value = { count, firstAt }
 *
 * `record` rolls forward the count when within the window, or starts a
 * fresh count when outside it. The decision (`push` | `bundle` | `skip`)
 * is returned to the caller — the worker uses it to choose between an
 * individual push, a debounced bundled push, or no push at all.
 */

export type BurstDecision =
  | { action: 'push'; count: number }
  | { action: 'bundle'; count: number; firstAt: number }
  | { action: 'skip' };

export interface BurstBundlerOptions {
  /** Threshold at which subsequent messages collapse into a bundled push. */
  threshold?: number;
  /** Window in ms within which messages count toward the same burst. */
  windowMs?: number;
  /** Clock injection point for tests. Defaults to `Date.now`. */
  now?: () => number;
}

interface BurstEntry {
  count: number;
  firstAt: number;
}

const DEFAULT_THRESHOLD = 3;
const DEFAULT_WINDOW_MS = 60_000;

export class BurstBundler {
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, BurstEntry>();

  constructor(opts: BurstBundlerOptions = {}) {
    this.threshold = opts.threshold ?? DEFAULT_THRESHOLD;
    this.windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Records an incoming message and returns the push decision. Callers use
   * the `action` field to decide whether to push individually, queue a
   * bundle, or skip.
   *
   * - First 1..threshold-1 messages in a window: `push` (count = 1, 2, …)
   * - threshold-th message in a window: `bundle` (count = threshold).
   *   The worker should fire ONE bundled push covering all prior messages.
   * - Subsequent messages in the same window: `skip` (already bundled).
   * - Messages outside the window: window resets, returns `push`.
   */
  record(key: string): BurstDecision {
    const now = this.now();
    const prior = this.entries.get(key);
    if (!prior || now - prior.firstAt > this.windowMs) {
      this.entries.set(key, { count: 1, firstAt: now });
      return { action: 'push', count: 1 };
    }
    const nextCount = prior.count + 1;
    this.entries.set(key, { count: nextCount, firstAt: prior.firstAt });
    if (nextCount < this.threshold) {
      return { action: 'push', count: nextCount };
    }
    if (nextCount === this.threshold) {
      return { action: 'bundle', count: nextCount, firstAt: prior.firstAt };
    }
    return { action: 'skip' };
  }

  /**
   * Drop stale entries whose window has fully elapsed. Worker calls this on
   * a periodic tick; not needed for correctness (the next `record` call
   * resets stale state automatically) but keeps memory bounded.
   */
  sweep(): void {
    const cutoff = this.now() - this.windowMs;
    for (const [key, entry] of this.entries) {
      if (entry.firstAt <= cutoff) this.entries.delete(key);
    }
  }

  /** Test introspection only. */
  size(): number {
    return this.entries.size;
  }
}
