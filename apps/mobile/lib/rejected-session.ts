import { Alert } from "react-native";
import {
  isAuthApiError,
  isAuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";

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
 * the same allowlist as `apps/api/src/interface/guards/guard-lookup.ts`.
 * Web keeps the same rule in `apps/web/lib/auth/rejected-session.ts`.
 */
export function isSessionOver(result: {
  data: { user: unknown };
  error: unknown;
}): boolean {
  const { data, error } = result;
  if (!error) return !data.user;
  if (isAuthRetryableFetchError(error)) return false;
  if (isAuthApiError(error) && (error.status >= 500 || error.status === 429)) {
    return false;
  }
  return true;
}

export const SESSION_ENDED_TITLE = "You've been signed out";
export const SESSION_ENDED_BODY =
  "This account no longer exists or its session ended. Sign in to continue.";

/**
 * Builds the SDK's `onUnauthorized` handler: check with Auth, then sign out
 * through the app's one sign-out path, which clears the token and the query
 * cache, and the auth gate takes the member to sign-in. Concurrent 401s from
 * one screen's reads collapse into a single check.
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
        if (!isSessionOver(await supabase.auth.getUser())) return;
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
