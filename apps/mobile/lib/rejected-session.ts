import { Alert } from "react-native";
import { isSessionOver } from "@repo/hooks/auth-error-copy";
import {
  isAuthSessionMissingError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { reportAuthFailure } from "./sentry/auth-failures";

/**
 * Auth's verdict on a session this device held when it asked. A session
 * revoked elsewhere (sign out everywhere, a password change) comes back from
 * GoTrue as `session_not_found`, which auth-js turns into
 * `AuthSessionMissingError`, not an `AuthApiError` (#4440). Read alone, that
 * error means "no session", so it counts as over only when a local session
 * existed before the call. Its report names the code, which the error itself
 * doesn't carry. Web keeps the same rule.
 */
function sessionVerdict(
  result: { data: { user: unknown }; error: unknown },
  hadLocalSession: boolean,
): { over: boolean; code?: string } {
  if (hadLocalSession && isAuthSessionMissingError(result.error)) {
    return { over: true, code: "session_not_found" };
  }
  return { over: isSessionOver(result) };
}

const SESSION_ENDED_TITLE = "You've been signed out";
const SESSION_ENDED_BODY =
  "This account no longer exists or its session ended. Sign in to continue.";

/**
 * Builds the SDK's `onUnauthorized` handler: check with Auth, then sign out
 * through the app's one sign-out path, which clears the token and the query
 * cache, and the auth gate takes the member to sign-in. Concurrent 401s from
 * one screen's reads collapse into a single check, and a 401 that lands after
 * the session is already gone returns before asking Auth, whose "no session"
 * answer would otherwise sign out (and alert) a second time.
 */
export function createRejectedSessionHandler(deps: {
  getSupabase: () => SupabaseClient | null;
  signOut: () => Promise<void>;
  notify?: () => void;
}): () => void {
  let checking = false;
  return () => {
    if (checking) return;
    const supabase = deps.getSupabase();
    if (!supabase) return;
    checking = true;
    void (async () => {
      try {
        const { data: local } = await supabase.auth.getSession();
        // Load-bearing: with no local session, getUser's "no session"
        // answer would read as a revoke (`sessionVerdict`).
        if (!local.session) return;
        const verdict = await supabase.auth.getUser();
        const { over, code } = sessionVerdict(verdict, true);
        if (!over) return;
        // Auth's reason is the count (#3832). This runs from the SDK's
        // response hook, which knows no route, so the screen is unnamed.
        reportAuthFailure({
          flow: "session_check",
          screen: "unknown",
          error: verdict.error,
          code,
        });
        await deps.signOut();
        (deps.notify ?? defaultNotify)();
      } catch {
        // Never throw out of a response hook; the screen keeps its own error.
      } finally {
        checking = false;
      }
    })();
  };
}

function defaultNotify(): void {
  Alert.alert(SESSION_ENDED_TITLE, SESSION_ENDED_BODY);
}
