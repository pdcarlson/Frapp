import type { QueryClient } from "@tanstack/react-query";
import {
  isAuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";

/**
 * The message a request carries when it is held back because the sign-in
 * refresh could not reach Auth. It is Chrome's dropped-connection message with
 * a parenthesized note, on purpose: the error copy and the retry policy read
 * a statusless failure as a dropped connection by its message
 * (`isNetworkFailure` in `@repo/hooks/error-copy`), and so does the query
 * reporter, whose match is anchored and allows one parenthesized suffix
 * (`DEAD_FETCH_MESSAGES` in `@repo/observability`'s `query-errors.ts`). So a
 * wake that fails every read in flight is one `network` warning in Sentry,
 * not one exception issue per screen read (#3746).
 */
export const SIGN_IN_REFRESH_UNREACHABLE_MESSAGE =
  "Failed to fetch (sign-in refresh did not reach Auth)";

/**
 * The SDK's `getAuthToken` for web: the session's access token, read through
 * `getSession()` on every request, which refreshes a session that is about to
 * expire.
 *
 * When that refresh can't reach Auth (a laptop waking from sleep, a dropped
 * connection, or Auth answering 502 to 504), supabase-js answers with no
 * session and an `AuthRetryableFetchError`, and keeps the stored session for
 * the next try. Reading that as "signed out" sent the read out with no token:
 * every query a dashboard fires at once came back 401 `no_bearer`, which is
 * the burst that tripped the API's auth-failure spike alert (FRAPP-API-E,
 * prod web, 2026-11-17 13:57Z, about 45 refusals in 35 seconds before the
 * refresh got through, #5360). Those 401s carry no `Authorization` header, so
 * `onUnauthorized` rightly ignores them, and a 401 is never retried.
 *
 * So that answer fails the request here, as the dropped connection it is,
 * without sending it. supabase-js then serves the same failure, without asking
 * Auth, to every `getSession()` for 60 seconds (`REFRESH_FAILURE_COOLDOWN_MS`),
 * so the query layer's own retries, about 7 seconds of them, usually fail
 * again; the reads come back once a refresh lands, through
 * {@link refetchFailedReadsOnTokenRefresh}.
 *
 * Any other "no session" is a signed-out client and still sends no token:
 * a refresh Auth refused outright drops the stored session and signs the tab
 * out, which `leaveWhenSignedOutElsewhere` (`rejected-session.ts`) acts on.
 */
export async function readRequestToken(
  supabase: Pick<SupabaseClient, "auth">,
): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? null;
  if (!token && isAuthRetryableFetchError(error)) {
    throw new TypeError(SIGN_IN_REFRESH_UNREACHABLE_MESSAGE, { cause: error });
  }
  return token;
}

/**
 * Refetch the reads that failed once the session refreshes. A read held back
 * by {@link readRequestToken} has used its retries long before supabase-js's
 * cooldown ends, and the browser never went offline, so no reconnect refetch
 * comes either: without this, a waking tab's screens kept their error states
 * until the member switched tabs or pressed Try again. Only reads in an error
 * state are refetched, so the hourly routine refresh costs nothing.
 *
 * Returns the unsubscribe.
 */
export function refetchFailedReadsOnTokenRefresh(
  supabase: Pick<SupabaseClient, "auth">,
  queryClient: Pick<QueryClient, "refetchQueries">,
): () => void {
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event !== "TOKEN_REFRESHED") return;
    void queryClient.refetchQueries({
      type: "active",
      predicate: (query) => query.state.status === "error",
    });
  });
  return () => data.subscription.unsubscribe();
}
