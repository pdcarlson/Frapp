import {
  isAuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";

/**
 * The message a request carries when it is held back because the sign-in
 * refresh could not reach Auth. It starts like Chrome's dropped-connection
 * `TypeError` on purpose: the error copy, the retry policy and the query
 * reporter all read a statusless failure by that message (`isNetworkFailure`
 * in `@repo/hooks/error-copy`), and this is one.
 */
export const SIGN_IN_REFRESH_UNREACHABLE_MESSAGE =
  "Failed to fetch: the sign-in refresh did not reach Auth";

/**
 * The SDK's `getAuthToken` for web: the session's access token, read through
 * `getSession()` on every request, which refreshes a session that is about to
 * expire.
 *
 * When that refresh can't reach Auth (a laptop waking from sleep, a dropped
 * connection), supabase-js answers with no session and an
 * `AuthRetryableFetchError`, and keeps the stored session for the next try.
 * Reading that as "signed out" sent the read out with no token: every query a
 * dashboard fires at once came back 401 `no_bearer`, which is the burst that
 * tripped the API's auth-failure spike alert (FRAPP-API-E, prod web,
 * 2026-11-17 13:57Z, about 45 refusals in 35 seconds before the refresh got
 * through). Those 401s carry no `Authorization` header, so `onUnauthorized`
 * rightly ignores them, and nothing on the screen said why.
 *
 * So that answer fails the request here, as the dropped connection it is,
 * without sending it. The query layer retries it as one, and the next try
 * asks `getSession()` again, which shares one refresh between callers.
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
