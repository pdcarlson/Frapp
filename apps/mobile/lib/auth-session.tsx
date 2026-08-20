"use client";

import type { Session, SupabaseClient } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AppState } from "react-native";
import { clearAuthToken, writeAuthToken } from "./auth-token";
import { getSupabaseClient, isSupabaseConfigured } from "./supabase";

/**
 * The claim `custom_access_token_hook` stamps into every issued access token.
 * Mirrors `ACTIVE_CHAPTER_CLAIM` in
 * `apps/api/src/interface/types/request-context.types.ts` — kept as a literal
 * because the mobile app must not import from the API workspace.
 */
const ACTIVE_CHAPTER_CLAIM = "active_chapter_id";

export type AuthMethod = "password" | "magic_link";

type AuthStatus = "hydrating" | "authenticated" | "unauthenticated";

type AuthSessionContextValue = {
  status: AuthStatus;
  email: string | null;
  /** Resolved from the access token's `active_chapter_id` claim; see below. */
  chapterId: string | null;
  /**
   * True while the first claim read for the current token is still in flight.
   *
   * `chapterId` is `null` both before the claim has been read and after it has
   * resolved to "no chapter", and a caller that treats those alike will act on
   * a not-yet-known answer. Anything gating on `chapterId === null` MUST wait
   * for this to be false — `lib/auth-gate.ts` is the one place that does, and
   * it is where the consequences are documented.
   *
   * It goes false on a bounded timeout as well as on settle, so a hung network
   * cannot leave a caller waiting forever.
   */
  isChapterResolving: boolean;
  /** False when `EXPO_PUBLIC_SUPABASE_*` are missing — sign-in cannot work. */
  isConfigured: boolean;
  /** Why the last magic-link callback failed, if it did. Cleared on retry. */
  callbackError: string | null;
  signInWithPassword: (input: {
    email: string;
    password: string;
  }) => Promise<void>;
  sendMagicLink: (input: { email: string }) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

/**
 * How long the routing gate will wait on the first chapter-claim read before
 * letting the app through without it.
 */
const CLAIM_READ_TIMEOUT_MS = 8_000;

const NOT_CONFIGURED_MESSAGE =
  "Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.";

/**
 * Pulls auth parameters out of a deep link.
 *
 * Supabase returns implicit-flow tokens in the URL *fragment* and PKCE codes in
 * the query string, so both halves are checked. `Linking.parse` only reads the
 * query string and would silently miss every magic-link callback.
 */
function readAuthParams(url: string): {
  accessToken: string | null;
  refreshToken: string | null;
  code: string | null;
  errorDescription: string | null;
} {
  const hashIndex = url.indexOf("#");
  const queryIndex = url.indexOf("?");

  const fragment = hashIndex >= 0 ? url.slice(hashIndex + 1) : "";
  const query =
    queryIndex >= 0
      ? url.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined)
      : "";

  const fragmentParams = new URLSearchParams(fragment);
  const queryParams = new URLSearchParams(query);
  const read = (name: string) =>
    fragmentParams.get(name) ?? queryParams.get(name);

  return {
    accessToken: read("access_token"),
    refreshToken: read("refresh_token"),
    code: read("code"),
    // URLSearchParams already decodes '+' to a space and %2B to a literal '+',
    // so no extra unescaping here — doing it again would turn an encoded plus
    // sign in the provider's message into a space.
    errorDescription: read("error_description") ?? read("error"),
  };
}

/**
 * Exchanges a magic-link callback for a session.
 *
 * Returns a message when the link itself was rejected. Magic links are
 * single-use and expire, so a dead link is routine — reporting nothing would
 * drop the member back on the sign-in screen with no way to tell a broken link
 * from a link they never tapped.
 */
async function createSessionFromUrl(
  supabase: SupabaseClient,
  url: string,
): Promise<string | null> {
  const { accessToken, refreshToken, code, errorDescription } =
    readAuthParams(url);

  if (errorDescription) return errorDescription;
  if (!accessToken && !refreshToken && !code) return null;

  try {
    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      return error ? error.message : null;
    }
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      return error ? error.message : null;
    }
    return null;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "That sign-in link could not be used. Request a new one.";
  }
}

export function AuthSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const configured = isSupabaseConfigured();

  const [status, setStatus] = useState<AuthStatus>(
    supabase ? "hydrating" : "unauthenticated",
  );
  const [session, setSession] = useState<Session | null>(null);
  /**
   * Last successfully read chapter claim, tagged with the user it belongs to.
   *
   * Chapter id and "has the first claim been read" are *derived* from this plus
   * the current session. An effect that `setState(null)` on user change would
   * lag one paint behind a magic-link account swap; deriving means the previous
   * member's chapter cannot appear on the new member's first render.
   */
  const [claimedChapter, setClaimedChapter] = useState<{
    userId: string | null;
    chapterId: string | null;
  }>({ userId: null, chapterId: null });
  /**
   * User id for whom the *first* chapter-claim read has finished.
   *
   * Deliberately not "a read is in flight". The claim is re-read on every token
   * change — the hourly auto-refresh, every foreground, every chapter switch —
   * and the routing gate renders nothing while resolving. Gating on in-flight
   * would therefore blank and remount the whole tab navigator about once an
   * hour, losing composer drafts and scroll position. A re-read only ever
   * confirms or changes a chapter, so only the first one is worth waiting for.
   *
   * The distinction is load-bearing rather than theoretical: `chapterId` is
   * always null in the current production configuration (#805 is open, so no
   * token carries the claim), which means "we already have a chapter" cannot be
   * the thing that skips the wait — this has to be.
   */
  const [claimReadForUserId, setClaimReadForUserId] = useState<string | null>(
    null,
  );
  const [callbackError, setCallbackError] = useState<string | null>(null);

  const url = Linking.useURL();
  const accessToken = session?.access_token ?? null;
  const userId = session?.user?.id ?? null;
  const chapterId =
    accessToken && claimedChapter.userId === userId
      ? claimedChapter.chapterId
      : null;
  /**
   * Whether the *first* chapter-claim read for the current account has finished.
   * False with no token (do not treat the pre-`getSession()` mount as resolved)
   * and false the moment `userId` changes, even before the claim effect re-runs.
   */
  const hasReadChapterClaim =
    Boolean(accessToken) && claimReadForUserId === userId;

  // Hydrate from persisted storage, then follow every subsequent change.
  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setSession(data.session ?? null);
        setStatus(data.session ? "authenticated" : "unauthenticated");
      })
      .catch(() => {
        if (!cancelled) setStatus("unauthenticated");
      });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (cancelled) return;
      setSession(nextSession ?? null);
      setStatus(nextSession ? "authenticated" : "unauthenticated");
      // A session arriving answers whatever the last failed link complained
      // about; leaving it set would show a stale error on the next sign-out.
      if (nextSession) setCallbackError(null);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  // Mirror the access token into SecureStore under the key the API SDK already
  // reads (`AUTH_TOKEN_STORAGE_KEY`). This is the whole seam: the SDK client
  // stays unaware of Supabase, and every refreshed token propagates for free.
  useEffect(() => {
    if (accessToken) {
      void writeAuthToken(accessToken);
    } else {
      void clearAuthToken();
    }
  }, [accessToken]);

  /**
   * Chapter context comes from the token claim, never from a local pick.
   *
   * Per `spec/behavior/multi-tenancy.md`, the `active_chapter_id` claim is
   * authoritative and `x-chapter-id` is only a fallback — if the two disagree
   * the API rejects *every* request with 403 `chapter.context.mismatch`.
   * Reading the claim makes disagreement impossible by construction.
   *
   * `null` is a safe resolution, not a failure: the API resolves a sole
   * membership server-side when no claim is present, so single-chapter members
   * work regardless. A multi-chapter member with no selection reaches the
   * picker from the More hub (#764) — see `lib/auth-gate.ts` for why that is
   * not a forced redirect.
   *
   * Selecting a chapter goes through `lib/select-chapter.ts`, which activates
   * server-side and then refreshes the session — the new token arrives here as
   * a changed `accessToken` and this effect re-reads the claim. That is why
   * there is still no local override: the claim stays the only source.
   *
   * Retention on a failed *read* is scoped to `claimedChapter.userId`. A magic
   * link can swap accounts with no sign-out; deriving `chapterId` from that tag
   * drops the previous member's chapter on the same render as the new session,
   * without an effect `setState(null)` that would lag one paint.
   */
  useEffect(() => {
    if (!supabase) return;

    if (!accessToken || !userId) {
      // Do NOT mark the claim as read here. This branch runs on mount, before
      // `getSession()` has resolved, and marking it read would let the gate
      // commit a render of the whole tab navigator on the next tick — which
      // then blanks and remounts the moment the real read starts. `chapterId`
      // and `hasReadChapterClaim` already derive to "not ready" without token.
      return;
    }

    const claimUserId = userId;
    let cancelled = false;

    // Stop *waiting* on the claim after a bounded delay — but keep listening.
    //
    // The routing gate renders nothing while the first read is in flight, and
    // this read is a real network call with no timeout of its own (React
    // Native's fetch has no default, and auth-js falls back to `getUser` here
    // because Hermes has no WebCrypto `subtle`). A captive portal accepts the
    // connection and then never answers, which would otherwise leave a blank
    // screen behind an already-hidden splash for as long as the socket hangs.
    //
    // Proceeding without the claim is safe by design — see `lib/auth-gate.ts`.
    // The request is deliberately not aborted: if it lands later, the claim
    // still applies.
    const resolveTimer = setTimeout(() => {
      if (!cancelled) setClaimReadForUserId(claimUserId);
    }, CLAIM_READ_TIMEOUT_MS);

    supabase.auth
      .getClaims()
      .then(({ data, error }) => {
        if (cancelled) return;
        // A failed *read* is not a resolved absence, and the two must not
        // collapse: the gate evicts a member with no chapter to the picker, so
        // nulling here on a network blip would throw someone out of the app
        // mid-use. `getClaims` is a real round trip on this platform — Hermes
        // has no WebCrypto `subtle`, so auth-js falls back to `getUser()` — and
        // it re-runs on every hourly refresh and every foreground. Keep the
        // last known chapter and let the next token try again.
        if (error || !data?.claims) return;
        const claim = data.claims[ACTIVE_CHAPTER_CLAIM];
        setClaimedChapter({
          userId: claimUserId,
          chapterId:
            typeof claim === "string" && claim.length > 0 ? claim : null,
        });
      })
      .catch(() => {
        // Same reasoning as above — retain, do not demote.
      })
      .finally(() => {
        // Each run owns its own `cancelled`, so a superseded read can never
        // clear the flag out from under the newer one that replaced it.
        if (!cancelled) setClaimReadForUserId(claimUserId);
        clearTimeout(resolveTimer);
      });

    return () => {
      cancelled = true;
      clearTimeout(resolveTimer);
    };
  }, [supabase, accessToken, userId]);

  // supabase-js refreshes tokens on a timer, and the OS suspends timers in the
  // background. Restart the loop whenever the app is foregrounded, or a session
  // idle past its expiry never recovers without a cold start.
  useEffect(() => {
    if (!supabase) return;

    if (AppState.currentState === "active") {
      void supabase.auth.startAutoRefresh();
    }

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void supabase.auth.startAutoRefresh();
      } else {
        void supabase.auth.stopAutoRefresh();
      }
    });

    return () => {
      subscription.remove();
      void supabase.auth.stopAutoRefresh();
    };
  }, [supabase]);

  // Magic-link callback: the link opens the app with tokens attached.
  useEffect(() => {
    if (!supabase || !url) return;

    let cancelled = false;
    void createSessionFromUrl(supabase, url).then((message) => {
      if (!cancelled && message) setCallbackError(message);
    });

    return () => {
      cancelled = true;
    };
  }, [supabase, url]);

  const signInWithPassword = useCallback(
    async ({ email, password }: { email: string; password: string }) => {
      if (!supabase) throw new Error(NOT_CONFIGURED_MESSAGE);
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
    },
    [supabase],
  );

  const sendMagicLink = useCallback(
    async ({ email }: { email: string }) => {
      if (!supabase) throw new Error(NOT_CONFIGURED_MESSAGE);
      // A fresh request supersedes whatever the last dead link reported.
      setCallbackError(null);
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: Linking.createURL("/") },
      });
      if (error) throw error;
    },
    [supabase],
  );

  const signOut = useCallback(async () => {
    try {
      if (supabase) {
        await supabase.auth.signOut();
      }
    } catch {
      // Never propagate. Callers navigate away on return (`profile.tsx`), so a
      // thrown network error would strand the member on an authenticated screen
      // while the local session below is already gone.
    }

    // Always clear locally, even when the remote revoke failed — a token left
    // in SecureStore would keep the SDK sending a Bearer header for a session
    // the member believes they ended.
    await clearAuthToken();
    setSession(null);
    setClaimedChapter({ userId: null, chapterId: null });
    setClaimReadForUserId(null);
    setStatus("unauthenticated");
  }, [supabase]);

  // Only the first read blocks, and only while signed in — see the state's own
  // comment for why an in-flight re-read must not.
  const isChapterResolving = status === "authenticated" && !hasReadChapterClaim;

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      status,
      email: session?.user?.email ?? null,
      chapterId,
      isChapterResolving,
      isConfigured: configured,
      callbackError,
      signInWithPassword,
      sendMagicLink,
      signOut,
    }),
    [
      callbackError,
      chapterId,
      configured,
      isChapterResolving,
      sendMagicLink,
      session?.user?.email,
      signInWithPassword,
      signOut,
      status,
    ],
  );

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession(): AuthSessionContextValue {
  const context = useContext(AuthSessionContext);

  if (!context) {
    throw new Error("useAuthSession must be used within AuthSessionProvider.");
  }

  return context;
}
