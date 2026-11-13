/**
 * How long after a lookup starts a later request may still join it. A mobile
 * resume's requests leave the phone together but can reach the API spread over
 * a few hundred milliseconds; past that, a request makes its own lookup.
 */
export const IN_FLIGHT_JOIN_WINDOW_MS = 250;

/**
 * Lets requests that arrive together share one lookup instead of each making
 * its own (#3728).
 *
 * A mobile app resuming from a push fires about seven requests at once, and
 * a cold app open about seventy, all with the same token and chapter, and
 * each ran the same guard lookups before any handler started.
 *
 * What a joiner gives up, and its bound: a request that joins gets an answer
 * whose query left up to `joinWindowMs` before the request arrived, so a
 * change committed inside that window is not seen by it. Paul accepted that
 * bound for the session check, membership and roles on 2026-11-13 (#3752,
 * reopened after an app open of about 70 requests filled PostgREST's pool),
 * and spec/behavior/rbac.md and multi-tenancy.md state it. A request arriving
 * after the window, or after the call settled, makes its own lookup. Nothing
 * is cached beyond the call.
 *
 * Joiners share the call's fate. The Supabase client sets no fetch timeout,
 * so if the call stalls, every request that joined it stalls with it. The
 * window limits that to requests arriving within `joinWindowMs` of the call's
 * start; the next request after that starts a fresh call and takes the key
 * over.
 *
 * Results are shared by reference, so callers copy what they put on the
 * request (`structuredClone`) rather than hand two requests one object.
 *
 * A rejection is shared too: every joiner gets it. The guards' loads resolve
 * to a `{ data, error }` result and decide per caller what to throw; the
 * repository reads behind `readSharedInBurst` reject on a PostgREST error, so
 * one failed read fails every request that joined it.
 */
export class InFlightLookups<T> {
  private readonly pending = new Map<
    string,
    { call: Promise<T>; startedAt: number }
  >();
  private readonly joinWindowMs: number;
  private readonly now: () => number;

  constructor(options: { joinWindowMs?: number; now?: () => number } = {}) {
    this.joinWindowMs = options.joinWindowMs ?? IN_FLIGHT_JOIN_WINDOW_MS;
    this.now = options.now ?? (() => performance.now());
  }

  run(key: string, load: () => PromiseLike<T>): Promise<T> {
    const now = this.now();
    const existing = this.pending.get(key);
    if (existing && now - existing.startedAt <= this.joinWindowMs) {
      return existing.call;
    }

    const entry = { startedAt: now } as { call: Promise<T>; startedAt: number };
    entry.call = Promise.resolve()
      .then(load)
      .finally(() => {
        // A newer call may have taken the key over; leave that one alone.
        if (this.pending.get(key) === entry) this.pending.delete(key);
      });
    this.pending.set(key, entry);
    return entry.call;
  }

  /** How many lookups are in flight; for tests. */
  get size(): number {
    return this.pending.size;
  }
}
