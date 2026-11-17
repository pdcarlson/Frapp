import { createHash } from 'node:crypto';

/** How a reserved lookup ended (`FailedLookupLimiter.settle`). */
export type LookupOutcome = 'found' | 'missed' | 'failed';

/**
 * Counts failed lookups of a credential per address, in fixed windows, and
 * says when an address has used up its allowance. For a public route whose
 * credential is a token in the request (the calendar feed), where the usual
 * per-address throttle can't apply because legitimate callers share
 * addresses.
 *
 * Only lookups that found nothing count. A lookup is reserved before it runs
 * (`reserve`) and settled once it answers (`settle`), so lookups in flight
 * count against the allowance too: concurrent requests cannot all pass the
 * check before any of them has missed.
 *
 * A credential that found something within `rememberHitsMs` is let through
 * even while its address is over the allowance: the allowance is there to
 * keep the database from answering a stream of misses, and it should not cut
 * off a working credential just because something else on the same address
 * (a shared network, a provider's fetch pool) keeps missing. Credentials are
 * remembered by a hash, never as given.
 *
 * In memory, per API instance, like the throttler's own storage. Both maps
 * are bounded: past their size, the entry added longest ago is dropped, which
 * at worst forgets a count early or holds a remembered credential to the
 * allowance again.
 */
export class FailedLookupLimiter {
  private readonly windows = new Map<
    string,
    { misses: number; inFlight: number; resetsAt: number }
  >();
  private readonly hits = new Map<string, number>();

  constructor(
    private readonly options: {
      /** Misses (lookups in flight included) an address gets per window. */
      limit: number;
      windowMs: number;
      maxAddresses: number;
      /** How long a credential that found something skips the allowance. */
      rememberHitsMs: number;
      maxRememberedHits: number;
    },
  ) {}

  /**
   * Reserves one lookup of `credential` from `address` and returns 0, or
   * returns the seconds until the address may look up again and reserves
   * nothing. Every 0 must be followed by one `settle`.
   */
  reserve(address: string, credential: string, now: number): number {
    const window = this.currentWindow(address, now);
    const used = window ? window.misses + window.inFlight : 0;
    if (
      window &&
      used >= this.options.limit &&
      !this.recentlyHit(credential, now)
    ) {
      return Math.max(1, Math.ceil((window.resetsAt - now) / 1000));
    }
    if (window) {
      window.inFlight += 1;
    } else {
      this.track(address, {
        misses: 0,
        inFlight: 1,
        resetsAt: now + this.options.windowMs,
      });
    }
    return 0;
  }

  /**
   * Ends a reserved lookup. `found` remembers the credential; `missed`
   * counts against the address and forgets the credential; `failed` (the
   * lookup could not answer either way) only releases the reservation.
   */
  settle(
    address: string,
    credential: string,
    outcome: LookupOutcome,
    now: number,
  ): void {
    const window = this.currentWindow(address, now);
    if (window) {
      window.inFlight = Math.max(0, window.inFlight - 1);
    }
    if (outcome === 'missed') {
      this.forgetHit(credential);
      if (window) {
        window.misses += 1;
      } else {
        this.track(address, {
          misses: 1,
          inFlight: 0,
          resetsAt: now + this.options.windowMs,
        });
      }
      return;
    }
    if (outcome === 'found') {
      this.rememberHit(credential, now);
    }
    if (window && window.misses === 0 && window.inFlight === 0) {
      this.windows.delete(address);
    }
  }

  /** The address's window, rolled over (in-flight lookups kept) when over. */
  private currentWindow(
    address: string,
    now: number,
  ): { misses: number; inFlight: number; resetsAt: number } | undefined {
    const window = this.windows.get(address);
    if (window && window.resetsAt <= now) {
      window.misses = 0;
      window.resetsAt = now + this.options.windowMs;
    }
    return window;
  }

  private track(
    address: string,
    window: { misses: number; inFlight: number; resetsAt: number },
  ): void {
    evictOldest(this.windows, this.options.maxAddresses);
    this.windows.set(address, window);
  }

  private recentlyHit(credential: string, now: number): boolean {
    const until = this.hits.get(hashOf(credential));
    return until !== undefined && until > now;
  }

  private rememberHit(credential: string, now: number): void {
    const key = hashOf(credential);
    this.hits.delete(key);
    evictOldest(this.hits, this.options.maxRememberedHits);
    this.hits.set(key, now + this.options.rememberHitsMs);
  }

  private forgetHit(credential: string): void {
    this.hits.delete(hashOf(credential));
  }
}

/** Makes room for one more entry, dropping the oldest (insertion order). */
function evictOldest(map: Map<string, unknown>, max: number): void {
  for (const key of map.keys()) {
    if (map.size < max) return;
    map.delete(key);
  }
}

function hashOf(credential: string): string {
  return createHash('sha256').update(credential).digest('hex');
}
