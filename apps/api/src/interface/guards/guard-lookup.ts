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
 * Lets requests that arrive together share one lookup instead of each making
 * its own (#3728).
 *
 * A mobile app resuming from a push fires about seven requests at once, all
 * with the same token and chapter, and each ran the same guard lookups: seven
 * `auth.getUser` calls and up to twenty-one PostgREST reads before any handler
 * started. A caller that asks for a key already in flight gets that call's
 * result; the entry is dropped once the call settles, so nothing is cached and
 * a result is never older than the request that asked for it. A request that
 * starts after the call settled makes its own.
 *
 * Results are shared by reference, so callers copy what they put on the
 * request (`structuredClone`) rather than hand two requests one object.
 *
 * `load` resolves to a `{ data, error }` result, never rejects in normal use;
 * a rejection is shared too, and each caller decides what to throw from it.
 */
export class InFlightLookups<T> {
  private readonly pending = new Map<string, Promise<T>>();

  run(key: string, load: () => PromiseLike<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing;

    const call = Promise.resolve()
      .then(load)
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, call);
    return call;
  }

  /** How many lookups are in flight; for tests. */
  get size(): number {
    return this.pending.size;
  }
}
