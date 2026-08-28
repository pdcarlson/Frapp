import * as SecureStore from "./secure-store";

/**
 * Where the API access token lives for `frapp-client.tsx`'s SDK middleware.
 *
 * This module is deliberately the *only* thing both the auth session provider
 * and the API client depend on. The provider writes; the client reads. Putting
 * the key in either of those two files instead would make them import each
 * other.
 */
export const AUTH_TOKEN_STORAGE_KEY = "frapp.mobile.auth-token";

type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * Notifies token readers within the running app.
 *
 * `useIsApiAuthenticated` cannot poll — before this existed it only re-read the
 * token when the app returned to the foreground, so a sign-in performed while
 * the app was already open left every hook believing the user was signed out
 * until they backgrounded and returned.
 */
export function subscribeToAuthToken(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyAuthTokenChanged() {
  // Copy first: a listener that unsubscribes itself would otherwise mutate the
  // set mid-iteration.
  for (const listener of [...listeners]) {
    listener();
  }
}

export async function readAuthToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function writeAuthToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(AUTH_TOKEN_STORAGE_KEY, token);
  } catch {
    // A failed write leaves the previous token in place; the next auth state
    // change retries. Surfacing it here would take down the sign-in screen for
    // a condition the SDK already degrades gracefully on (401 -> re-auth).
  } finally {
    notifyAuthTokenChanged();
  }
}

export async function clearAuthToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // Same rationale as writeAuthToken. Sign-out must never appear to fail.
  } finally {
    notifyAuthTokenChanged();
  }
}
