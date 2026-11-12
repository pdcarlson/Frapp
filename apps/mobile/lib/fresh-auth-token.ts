import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * How close to its `exp` a token counts as stale. supabase-js's own
 * `getSession()` refreshes inside the same 90-second margin, so a token this
 * reader hands on is one Auth would also still call current.
 */
export const TOKEN_EXPIRY_MARGIN_MS = 90_000;

/**
 * A JWT's payload, decoded without verifying it (the API verifies). `null` for
 * anything that isn't a three-part JWT with an object payload.
 */
export function accessTokenPayload(
  token: string,
): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const payload: unknown = JSON.parse(atob(padded));
    return payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * A JWT's `exp` and `iat` in epoch milliseconds. `null` for anything that
 * isn't a JWT with a numeric `exp`; `issuedAt` is `null` when `iat` is missing.
 */
export function accessTokenTimes(
  token: string,
): { expiresAt: number; issuedAt: number | null } | null {
  const payload = accessTokenPayload(token);
  if (!payload) return null;
  const { exp, iat } = payload;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  return {
    expiresAt: exp * 1000,
    issuedAt:
      typeof iat === "number" && Number.isFinite(iat) ? iat * 1000 : null,
  };
}

/** The reader, plus the one way to make it stop trusting what it learned. */
export type FreshAuthTokenReader = (() => Promise<string | null>) & {
  /**
   * Drop the learned clock offset. The SDK's `onUnauthorized` calls it: a 401
   * means a token the reader called current wasn't, so the offset is the
   * first suspect. Without this, an offset learned from a token that only
   * looked newly issued, or before the OS corrected the device clock, stayed
   * for the life of the process and kept expired tokens going out.
   */
  forgetClockOffset: () => void;
};

/**
 * The SDK's `getAuthToken` for mobile: the mirrored token, unless it is about
 * to expire, in which case the session is refreshed first (#3907).
 *
 * The mirror (`lib/auth-token.ts`) only changes when supabase-js emits a new
 * session, and supabase-js refreshes on a timer the OS suspends in the
 * background. So a member who opens the app after an hour away had every
 * query that refetches on focus go out at once with the expired token, about
 * twenty 401s in under half a second, before the restarted timer's refresh
 * landed. That burst is what tripped the API's auth-failure spike alert
 * (FRAPP-API-D/E), from `ios/0.10.3+15` on 2026-11-10.
 *
 * Web never had this: its reader asks `getSession()` on every request
 * (`apps/web/lib/providers/frapp-client-provider.tsx`). Mobile keeps the cheap
 * mirror on the hot path, because `getSession()` reads the chunked SecureStore
 * session every time, and asks Auth only when the mirror can't be used.
 * `getSession()` refreshes an expiring session, and supabase-js shares one
 * refresh between concurrent callers, so a burst waits on a single refresh.
 *
 * When the refresh fails, the mirrored token goes out as before: the API's
 * 401 then reaches `onUnauthorized`, which owns deciding whether the session
 * is over (`lib/rejected-session.ts`).
 *
 * `exp` is stamped by Auth's clock and compared with the device's. On a phone
 * running an hour fast, every new token would look stale and every request
 * would wait on a refresh. So when a refresh hands back a new token, its `iat`
 * (Auth's "now", give or take the round trip) sets the device-to-Auth offset,
 * and later checks use it: skew costs one refresh, not one per request. A 401
 * drops what it learned ({@link FreshAuthTokenReader.forgetClockOffset}), so a
 * wrong offset costs one refused request rather than every one after it.
 */
export function createFreshAuthTokenReader(deps: {
  readToken: () => Promise<string | null>;
  getSupabase: () => SupabaseClient | null;
  now?: () => number;
}): FreshAuthTokenReader {
  const now = deps.now ?? Date.now;
  /** Auth's clock minus the device's, learned from the last refresh. */
  let offsetMs = 0;
  const read = async (): Promise<string | null> => {
    const token = await deps.readToken();
    if (!token) return token;
    const times = accessTokenTimes(token);
    if (
      !times ||
      times.expiresAt - (now() + offsetMs) > TOKEN_EXPIRY_MARGIN_MS
    ) {
      return token;
    }
    const supabase = deps.getSupabase();
    if (!supabase) return token;
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) return token;
      // No error and no session is a signed-out client. Send no token rather
      // than one Auth has already let go of.
      const fresh = data.session?.access_token ?? null;
      // Learn the offset only when Auth just issued a token and it still looks
      // stale: with a right clock a refreshed token has its full lifetime
      // left, so only skew explains it.
      //
      // "Just issued" is load-bearing. When a refresh fails while the stored
      // token is inside the margin but not yet past `exp`, supabase-js hands
      // back that same token unrefreshed and reports no error. It looks stale
      // too, and its `iat` is about an hour old, so learning from it set the
      // offset to minus an hour: every token after that looked an hour
      // younger than it was, and expired ones went out unrefreshed. That is
      // the 401 burst FRAPP-API-E caught again on ios/0.11.0+20, 2026-11-12.
      const freshTimes = fresh ? accessTokenTimes(fresh) : null;
      if (
        fresh !== token &&
        freshTimes?.issuedAt != null &&
        freshTimes.issuedAt > (times.issuedAt ?? Number.NEGATIVE_INFINITY) &&
        freshTimes.expiresAt - (now() + offsetMs) <= TOKEN_EXPIRY_MARGIN_MS
      ) {
        offsetMs = freshTimes.issuedAt - now();
      }
      return fresh;
    } catch {
      return token;
    }
  };
  return Object.assign(read, {
    forgetClockOffset: () => {
      offsetMs = 0;
    },
  });
}
