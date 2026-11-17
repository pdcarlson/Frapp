/**
 * Counts failed lookups of a credential per address, in fixed windows, and
 * says when an address has used up its allowance. For a public route whose
 * credential is a token in the request (the calendar feed), where the usual
 * per-address throttle can't apply because legitimate callers share
 * addresses: only lookups that found nothing count, so an address that keeps
 * fetching real links is never slowed.
 *
 * In memory, per API instance, like the throttler's own storage. The map is
 * bounded: past `maxAddresses`, the address seen longest ago is dropped,
 * which at worst forgets a count early.
 */
export class FailedLookupLimiter {
  private readonly windows = new Map<
    string,
    { count: number; resetsAt: number }
  >();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxAddresses: number,
  ) {}

  /**
   * Seconds until `address` may look up again, or 0 when it may now. An
   * address is refused once it has `limit` misses in the current window.
   */
  retryAfterSeconds(address: string, now: number): number {
    const window = this.windows.get(address);
    if (!window || window.resetsAt <= now || window.count < this.limit) {
      return 0;
    }
    return Math.max(1, Math.ceil((window.resetsAt - now) / 1000));
  }

  /** Count one lookup from `address` that found nothing. */
  recordMiss(address: string, now: number): void {
    const window = this.windows.get(address);
    if (window && window.resetsAt > now) {
      window.count += 1;
      return;
    }
    this.windows.delete(address);
    if (this.windows.size >= this.maxAddresses) {
      // A Map iterates in insertion order: the first key is the oldest.
      for (const oldest of this.windows.keys()) {
        this.windows.delete(oldest);
        break;
      }
    }
    this.windows.set(address, { count: 1, resetsAt: now + this.windowMs });
  }
}
