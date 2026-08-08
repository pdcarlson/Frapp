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
  /** False when `EXPO_PUBLIC_SUPABASE_*` are missing — sign-in cannot work. */
  isConfigured: boolean;
  signInWithPassword: (input: {
    email: string;
    password: string;
  }) => Promise<void>;
  sendMagicLink: (input: { email: string }) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

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
  };
}

async function createSessionFromUrl(
  supabase: SupabaseClient,
  url: string,
): Promise<void> {
  const { accessToken, refreshToken, code } = readAuthParams(url);

  try {
    if (accessToken && refreshToken) {
      await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      return;
    }
    if (code) {
      await supabase.auth.exchangeCodeForSession(code);
    }
  } catch {
    // A stale or replayed link is the common case here. Leaving the session
    // untouched keeps the user on the sign-in screen, which is the correct
    // outcome; onAuthStateChange reports any real success.
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
  const [chapterId, setChapterId] = useState<string | null>(null);

  const url = Linking.useURL();
  const accessToken = session?.access_token ?? null;

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
   * `null` is a safe resolution, not a failure: the hook already resolves a
   * sole membership server-side, so single-chapter members work regardless.
   * Only a multi-chapter member with no persisted selection lands here, and
   * they need an explicit picker (filed as a follow-up).
   */
  useEffect(() => {
    if (!supabase) return;

    if (!accessToken) {
      setChapterId(null);
      return;
    }

    let cancelled = false;

    supabase.auth
      .getClaims()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.claims) {
          setChapterId(null);
          return;
        }
        const claim = data.claims[ACTIVE_CHAPTER_CLAIM];
        setChapterId(typeof claim === "string" && claim.length > 0 ? claim : null);
      })
      .catch(() => {
        if (!cancelled) setChapterId(null);
      });

    return () => {
      cancelled = true;
    };
  }, [supabase, accessToken]);

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
    void createSessionFromUrl(supabase, url);
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
    } finally {
      // Always clear locally. A network-failed signOut that left the token in
      // SecureStore would keep the SDK sending a Bearer header the user has
      // already revoked in the UI.
      await clearAuthToken();
      setSession(null);
      setChapterId(null);
      setStatus("unauthenticated");
    }
  }, [supabase]);

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      status,
      email: session?.user?.email ?? null,
      chapterId,
      isConfigured: configured,
      signInWithPassword,
      sendMagicLink,
      signOut,
    }),
    [
      chapterId,
      configured,
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
