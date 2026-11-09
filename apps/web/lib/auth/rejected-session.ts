"use client";

import { isAuthApiError } from "@supabase/supabase-js";
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
 * (a dropped request, a 5xx, a 429, an unreadable body) is not a verdict. This
 * is stricter than the guard's `isAuthOutage`: here a wrong "over" signs a
 * member out.
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

let checking = false;
/** Set once this tab is on its way to `/sign-in` with the notice. */
let leaving = false;

/** Routes a signed-out visitor belongs on; nothing here sends them away. */
const SIGNED_OUT_ROUTES = [
  "/sign-in",
  "/sign-up",
  "/join",
  "/no-access",
  // Its own Sign out sends the member to `/sign-in` with the destination kept;
  // leaving first would drop it (#3786).
  "/new-account",
  "/auth",
];

/**
 * The session ended outside this tab's own sign-out paths: another tab of the
 * same browser signed out (they share the session cookie, and Supabase tells
 * every tab), so this one is left on a dashboard whose reads carry no token.
 * Go to `/sign-in`, unless this tab is already leaving with the notice, whose
 * URL must not be overwritten, or is on a route that is fine signed out.
 */
export function leaveWhenSignedOutElsewhere(): void {
  if (leaving) return;
  const path = window.location.pathname;
  if (SIGNED_OUT_ROUTES.some((r) => path === r || path.startsWith(`${r}/`))) {
    return;
  }
  window.location.assign("/sign-in");
}

/**
 * Sign out and land on `/sign-in` once the API has refused this session and
 * Auth agrees it is over. Wired to the SDK's `onUnauthorized`, so every
 * dashboard screen shares this one outcome instead of its own error state.
 *
 * A screen fires several reads at once, so concurrent 401s collapse into one
 * check. The sign-out is local: the server-side revoke needs the very session
 * Auth just refused, and the local session is what keeps the tab signed in.
 * Leaving by full navigation drops every in-memory cache with the page. The
 * persisted chat cache gets the same best-effort wipe as the account menu's
 * sign-out (`frapp-client-provider.tsx`'s identity effect), which may not land
 * before the navigation; keying by account is what keeps it from leaking.
 *
 * A 401 that lands after the local session is already gone (a slow read from
 * the burst) has nothing left to sign out, so it returns before asking Auth,
 * whose "no session" answer would otherwise read as another ended session.
 */
export async function handleRejectedSession(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const supabase = createSupabaseBrowserClient();
    const { data: local } = await supabase.auth.getSession();
    if (!local.session) return;
    if (!isSessionOver(await supabase.auth.getUser())) return;
    // Before the sign-out: its `SIGNED_OUT` reaches the identity effect in
    // `frapp-client-provider.tsx`, which must not send this tab to a bare
    // `/sign-in` over the URL that carries the notice.
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
