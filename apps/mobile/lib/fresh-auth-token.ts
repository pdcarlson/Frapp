import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * How close to its `exp` a token counts as stale. supabase-js's own
 * `getSession()` refreshes inside the same 90-second margin, so a token this
 * reader hands on is one Auth would also still call current.
 */
export const TOKEN_EXPIRY_MARGIN_MS = 90_000;

/**
 * When a JWT's `exp` falls, in epoch milliseconds, read from its payload
 * without verifying it (the API verifies). `null` for anything that isn't a
 * three-part JWT with a numeric `exp`.
 */
export function accessTokenExpiresAt(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const payload: unknown = JSON.parse(atob(padded));
    if (!payload || typeof payload !== "object") return null;
    const { exp } = payload as { exp?: unknown };
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

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
 */
export function createFreshAuthTokenReader(deps: {
  readToken: () => Promise<string | null>;
  getSupabase: () => SupabaseClient | null;
  now?: () => number;
}): () => Promise<string | null> {
  const now = deps.now ?? Date.now;
  return async () => {
    const token = await deps.readToken();
    if (!token) return token;
    const expiresAt = accessTokenExpiresAt(token);
    if (expiresAt === null || expiresAt - now() > TOKEN_EXPIRY_MARGIN_MS) {
      return token;
    }
    const supabase = deps.getSupabase();
    if (!supabase) return token;
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) return token;
      // No error and no session is a signed-out client. Send no token rather
      // than one Auth has already let go of.
      return data.session?.access_token ?? null;
    } catch {
      return token;
    }
  };
}
