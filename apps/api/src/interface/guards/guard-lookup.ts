import { ServiceUnavailableException } from '@nestjs/common';
import {
  isAuthApiError,
  isAuthRetryableFetchError,
} from '@supabase/supabase-js';

/**
 * A guard could not finish a lookup it needs to decide, so it cannot say who
 * the caller is or what they may do (#3143).
 *
 * That is not a refusal. Clients treat a 401 or 403 as final: web stops
 * retrying a mutation that got one (#3100), mobile never retried them, and a
 * 401 can sign the member out. Answered as a 4xx, a brief Auth or database
 * outage tells every member at once that their session or membership is
 * gone, where a 503 tells them to try again, and they do.
 *
 * It still fails closed: the request is refused either way, and only the
 * status moves from 4xx to 5xx. The failure rides along as the cause, so the
 * 5xx report in `AllExceptionsFilter` reaches Sentry with it, and the
 * response body stays generic. A 5xx is also not a `security_event`, so an
 * outage stops counting toward the auth-failure spike detector.
 */
export function lookupUnavailable(
  message: string,
  cause: Error,
): ServiceUnavailableException {
  return new ServiceUnavailableException(message, { cause });
}

/**
 * Whether `supabase.auth.getUser` failed without judging the token: the
 * request never got an answer (`AuthRetryableFetchError`, which auth-js
 * throws for a dropped connection and for 500-504 and 520-530), or Auth
 * answered with any other 5xx or a 429.
 *
 * An allowlist of outage signals, not "anything but a 4xx", on purpose:
 * every other `AuthError` keeps the 401, including the ones auth-js builds
 * itself, such as a missing session, and `AuthUnknownError`, whose unreadable
 * body comes with a non-5xx status and so says nothing about an outage. A new
 * error class the list does not name stays a 401, which is the old behavior,
 * rather than turning into a 503 nobody chose.
 */
export function isAuthOutage(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return true;
  return isAuthApiError(error) && (error.status >= 500 || error.status === 429);
}

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
 * A mobile app resuming from a push fires about seven requests at once, all
 * with the same token and chapter, and each ran the same guard lookups before
 * any handler started.
 *
 * What a joiner gives up, and its bound: a request that joins gets an answer
 * whose query left up to `joinWindowMs` before the request arrived, so a
 * change committed inside that window is not seen by it. So it is used only
 * where no spec promises same-instant freshness (see `ChapterGuard`):
 * spec/behavior/rbac.md and multi-tenancy.md promise that role and membership
 * changes take effect on the very next request, so those reads, and the
 * session check, stay per request. A request arriving after the window, or after the
 * call settled, makes its own lookup. Nothing is cached beyond the call.
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
 * `load` resolves to a `{ data, error }` result, never rejects in normal use;
 * a rejection is shared too, and each caller decides what to throw from it.
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
