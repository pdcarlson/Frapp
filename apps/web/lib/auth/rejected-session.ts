"use client";

import { isAuthApiError, isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { signOutCurrentSession } from "@/lib/auth/session";

/**
 * The `/sign-in` query value that says why the member landed there. The
 * sign-in screen shows one notice for it (`sign-in-screen.tsx`).
 */
export const SESSION_ENDED_PARAM = "signedOut";
export const SESSION_ENDED_VALUE = "session_ended";

/**
 * Whether Supabase Auth's answer to `getUser()` means this session is over.
 *
 * The API answers 401 when `SupabaseAuthGuard`'s `getUser(token)` rejects the
 * token, and the commonest way to get there with a signed-in tab is an account
 * deleted somewhere else: the access token in this browser stays valid until it
 * expires, but its user no longer exists, so every read fails and each screen
 * used to render its own failure for it ("Chapter unavailable", "Couldn't load
 * messages", a stuck "Reconnecting…").
 *
 * The browser asks Auth itself before acting on the API's word, so a stray 401
 * never signs a member out. Auth must judge the token to count: an outage
 * (a dropped request, a 5xx, a 429) is not a verdict, the same allowlist the
 * guard keeps in `apps/api/src/interface/guards/guard-lookup.ts`.
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

let checking = false;

/**
 * Sign out and land on `/sign-in` once the API has refused this session and
 * Auth agrees it is over. Wired to the SDK's `onUnauthorized`, so every
 * dashboard screen shares this one outcome instead of its own error state.
 *
 * A screen fires several reads at once, so concurrent 401s collapse into one
 * check. The sign-out is local: the server-side revoke needs the very session
 * Auth just refused, and the local session is what keeps the tab signed in.
 * Leaving by full navigation drops every in-memory cache with the page, and the
 * `SIGNED_OUT` event reaches `frapp-client-provider.tsx`'s identity effect
 * first, which wipes the persisted chat cache as any other sign-out does.
 */
export async function handleRejectedSession(): Promise<void> {
  if (checking) return;
  checking = true;
  let leaving = false;
  try {
    const supabase = createSupabaseBrowserClient();
    if (!isSessionOver(await supabase.auth.getUser())) return;
    leaving = true;
    await signOutCurrentSession({ scope: "local" });
    const url = new URL("/sign-in", window.location.origin);
    url.searchParams.set(SESSION_ENDED_PARAM, SESSION_ENDED_VALUE);
    window.location.assign(url.toString());
  } catch {
    // Never throw out of a response hook. A failed check leaves the screen's
    // own error state in place, which is what happened before this existed.
    leaving = false;
  } finally {
    // Once leaving, stay latched: the reads still in flight must not start a
    // second sign-out while the page navigates away.
    if (!leaving) checking = false;
  }
}
