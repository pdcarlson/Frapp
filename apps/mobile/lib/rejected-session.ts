import { Alert } from "react-native";
import { isAuthApiError, type SupabaseClient } from "@supabase/supabase-js";
import { reportAuthFailure } from "./sentry/auth-failures";

/**
 * Whether Supabase Auth's answer to `getUser()` means this session is over.
 *
 * The API answers 401 when `SupabaseAuthGuard` rejects the token. With a
 * signed-in device, the usual cause is an account deleted on another device:
 * the access token here stays valid until it expires, but its user is gone,
 * so every screen failed in its own way and nothing signed the member out.
 *
 * Auth is asked before acting on the API's word, so a stray 401 never signs a
 * member out, and an Auth outage (dropped request, 5xx, 429) is not a verdict:
 * stricter than the guard's `isAuthOutage` (`apps/api/src/interface/guards/guard-lookup.ts`).
 * Web keeps the same rule in `apps/web/lib/auth/rejected-session.ts`.
 */
export function isSessionOver(result: {
  data: { user: unknown };
  error: unknown;
}): boolean {
  const { data, error } = result;
  if (!error) return !data.user;
  // Only Auth's own 4xx judges the token. Anything else (a dropped request, a
  // 5xx, a 429, an unreadable body from a proxy in front of Auth, or no local
  // session left to ask about) is not a verdict, and signing out on it would
  // sign every member out during an outage.
  return (
    isAuthApiError(error) &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  );
}

export const SESSION_ENDED_TITLE = "You've been signed out";
export const SESSION_ENDED_BODY =
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
        if (!local.session) return;
        const verdict = await supabase.auth.getUser();
        if (!isSessionOver(verdict)) return;
        // Auth's reason is the count (#3832). This runs from the SDK's
        // response hook, which knows no route, so the screen is unnamed.
        reportAuthFailure({
          flow: "session_check",
          screen: "unknown",
          error: verdict.error,
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
