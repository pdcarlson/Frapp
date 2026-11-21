"use client";

import type { Session, SupabaseClient } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { signInWithNativeApple } from "./apple-auth";
import { signInWithNativeGoogle } from "./google-auth";
import { MemberFacingError } from "@repo/hooks/error-copy";
import { describeEmailCodeError } from "@repo/hooks/auth-error-copy";
import {
  describeAuthReturnError,
  describeOAuthKickoffError,
  FINISH_FAILED_COPY,
  START_FAILED_COPY,
  type OAuthProvider,
} from "./auth-providers";
import { clearAuthToken, writeAuthToken } from "./auth-token";
import { accessTokenPayload } from "./fresh-auth-token";
import { resetObservabilityOnLogout } from "./observability/reset";
import { reportAuthFailure } from "./sentry/auth-failures";
import {
  clearProductQueryCache,
  noteRefreshedSignInToken,
} from "./query-client";
import { getSupabaseClient, isSupabaseConfigured } from "./supabase";

WebBrowser.maybeCompleteAuthSession();

/**
 * The claim `custom_access_token_hook` stamps into every issued access token.
 * Mirrors `ACTIVE_CHAPTER_CLAIM` in
 * `apps/api/src/interface/types/request-context.types.ts` — kept as a literal
 * because the mobile app must not import from the API workspace.
 */
const ACTIVE_CHAPTER_CLAIM = "active_chapter_id";

/** The token's own chapter claim, read without verifying it. */
function chapterClaimOf(token: string): unknown {
  return accessTokenPayload(token)?.[ACTIVE_CHAPTER_CLAIM];
}

/**
 * The chapter the token names, or `null` when it names none.
 *
 * Decoded on the phone, never verified, and never sent anywhere: it picks
 * which chapter the app renders and which `x-chapter-id` it sends, and the
 * API re-reads the same claim from the verified token on every request
 * (`ChapterGuard`, `spec/behavior/multi-tenancy.md`). Web reads it the same
 * way (`apps/web/lib/auth/active-chapter-claim.ts`).
 *
 * It used to come from `supabase.auth.getClaims()`, which on Hermes (no
 * WebCrypto `subtle`) falls back to `getUser()`: a round trip to Supabase Auth
 * that every launch waited on before the first screen could mount, for up to
 * eight seconds on a bad connection, to learn what the token in hand already
 * said (#5768).
 */
function chapterIdOf(token: string): string | null {
  const claim = chapterClaimOf(token);
  return typeof claim === "string" && claim.length > 0 ? claim : null;
}

export type AuthMethod = "password" | "magic_link";

type AuthStatus = "hydrating" | "authenticated" | "unauthenticated";

type AuthSessionContextValue = {
  status: AuthStatus;
  email: string | null;
  /**
   * Supabase auth uid. Changes on the same render as a magic-link account
   * swap — chapter claim already keys on this. Observability identity must
   * too; `useViewerUserId` can still hold the previous `["user","me"]` row.
   */
  userId: string | null;
  /** Resolved from the access token's `active_chapter_id` claim; see below. */
  chapterId: string | null;
  /**
   * True while the member is signed in but no access token is in hand yet, so
   * the chapter claim can't be read.
   *
   * `chapterId` is `null` both before the claim can be read and when the
   * token names no chapter, and a caller that treats those alike will act on
   * a not-yet-known answer. Anything gating on `chapterId === null` MUST wait
   * for this to be false — `lib/auth-gate.ts` is the one place that does, and
   * it is where the consequences are documented.
   *
   * The claim is decoded from the token on the phone, so this never waits on
   * the network (#5768).
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
  /**
   * Signs in with the six-digit code from the same email a magic link sends
   * (#5625), so the invite card never has to leave the app. Needs the Auth
   * email template to print `{{ .Token }}`; until it does, the link is the
   * way in.
   */
  verifyEmailCode: (input: { email: string; code: string }) => Promise<void>;
  /**
   * Sends the sign-up confirmation email again, for a password account that
   * was never confirmed (`email_not_confirmed`, #3833). Its link opens the app
   * through the same `frapp:///?` redirect as a magic link, so opening it on
   * this phone signs the member in.
   */
  resendConfirmation: (input: { email: string }) => Promise<void>;
  /**
   * Google, or Apple. Native SIWA is tried first on iOS; otherwise an Expo
   * auth session opens the provider and the returned URL is exchanged here.
   */
  signInWithOAuthProvider: (provider: OAuthProvider) => Promise<void>;
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
const EMAIL_OTP_TYPES = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
] as const;

type EmailOtpType = (typeof EMAIL_OTP_TYPES)[number];

function isEmailOtpType(value: string): value is EmailOtpType {
  return (EMAIL_OTP_TYPES as readonly string[]).includes(value);
}

function readAuthParams(url: string): {
  accessToken: string | null;
  refreshToken: string | null;
  code: string | null;
  tokenHash: string | null;
  otpType: string | null;
  errorDescription: string | null;
  errorCode: string | null;
  /** The bare `error` identifier (`access_denied`), kept apart from the sentence. */
  error: string | null;
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
    tokenHash: read("token_hash"),
    otpType: read("type"),
    // URLSearchParams already decodes '+' to a space and %2B to a literal '+',
    // so no extra unescaping here — doing it again would turn an encoded plus
    // sign in the provider's message into a space.
    errorDescription: read("error_description") ?? read("error"),
    errorCode: read("error_code"),
    error: read("error"),
  };
}

/**
 * Where an email link (magic link, the confirmation resend) or a provider
 * return sends the member back into the app. The hosted Magic Link template
 * appends `&token_hash=…&type=magiclink` onto `{{ .RedirectTo }}`. Web's
 * callback already has `?next=`; this URL must also carry `?` or the `&`
 * produces `frapp:///&token_hash=`.
 */
function appRedirectTo(): string {
  const redirectTo = Linking.createURL("/");
  return redirectTo.includes("?") ? redirectTo : `${redirectTo}?`;
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
  const {
    accessToken,
    refreshToken,
    code,
    tokenHash,
    otpType,
    errorDescription,
    errorCode,
    error: errorIdentifier,
  } = readAuthParams(url);
  // A link or provider return that didn't become a session (#3832). Only the
  // code is read, never the URL, which holds the code or token itself.
  const reportCallback = (error: unknown, linkCode?: string) =>
    reportAuthFailure({
      flow: "auth_callback",
      screen: "/sign-in",
      error,
      code: linkCode,
    });

  if (errorDescription || errorCode) {
    // `error_code` is GoTrue's, `error` the provider's identifier
    // (`access_denied`); `error_description` is a sentence and never sent.
    reportCallback(undefined, errorCode ?? errorIdentifier ?? undefined);
    return describeAuthReturnError({
      message: errorDescription ?? errorCode ?? undefined,
      code: errorCode ?? undefined,
    });
  }
  if (!accessToken && !refreshToken && !code && !tokenHash) return null;

  try {
    if (accessToken && refreshToken) {
      // The implicit flow's return, and the one a new address's link takes
      // today: the hosted Confirm signup template still links
      // `ConfirmationURL` (#1925), which lands tokens in the fragment.
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) reportCallback(error);
      return error ? describeAuthReturnError(error) : null;
    }
    if (tokenHash) {
      if (!otpType || !isEmailOtpType(otpType)) {
        reportCallback(undefined, "verify_failed");
        return FINISH_FAILED_COPY;
      }
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: otpType,
      });
      if (error) reportCallback(error);
      return error ? describeAuthReturnError(error) : null;
    }
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) reportCallback(error);
      return error ? describeAuthReturnError(error) : null;
    }
    return null;
  } catch (error) {
    reportCallback(error);
    return describeAuthReturnError(error);
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
  const [callbackError, setCallbackError] = useState<string | null>(null);
  /**
   * Last auth uid observed in `applySession`.
   *
   * A magic-link swap stays `authenticated` and can keep the same chapter, so
   * the chapter-keyed `FrappProvider` clear is not the product-cache owner.
   * Comparing uid here — after the in-process Bearer write, before
   * `setSession` — drops `["user","me"]` / `["settings"]` before the next
   * session is treated as settled, while observers that refetch on the clear
   * already see User B's token. Token refresh keeps the same uid and must not
   * clear. A first uid (`null` → A) is a sign-in, not a swap.
   */
  const previousAuthUserIdRef = useRef<string | null>(null);
  const previousAccessTokenRef = useRef<string | null>(null);
  /**
   * Last deep-link URL we already exchanged. OAuth `openAuthSessionAsync`
   * returns the same URL that `Linking.useURL` then delivers; exchanging a
   * single-use `code` twice would set callbackError on the winner.
   */
  const lastHandledCallbackUrl = useRef<string | null>(null);

  const url = Linking.useURL();
  const accessToken = session?.access_token ?? null;
  const userId = session?.user?.id ?? null;
  /**
   * Derived from the token on every render, so a magic-link account swap or a
   * chapter switch's refreshed token changes the chapter on the same render as
   * the session, with no read to wait on and nothing of the previous member's
   * to retain.
   */
  const chapterId = accessToken ? chapterIdOf(accessToken) : null;

  // Hydrate from persisted storage, then follow every subsequent change.
  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;

    const applySession = (
      nextSession: Session | null,
      opts: { clearCallbackError: boolean },
    ) => {
      if (cancelled) return;
      // Memory-token update is synchronous inside write/clear so identity
      // GET cannot go out with the previous member's Bearer. Child effects
      // run before the token-mirror effect below.
      if (nextSession?.access_token) {
        void writeAuthToken(nextSession.access_token);
      } else {
        void clearAuthToken();
      }
      // Product cache next, still on this turn: observers that refetch on
      // `queryClient.clear()` must already see User B's Bearer. Clearing
      // before the write would refill `["user","me"]` with User A's token.
      const nextUserId = nextSession?.user?.id ?? null;
      const previousUserId = previousAuthUserIdRef.current;
      if (previousUserId && previousUserId !== nextUserId) {
        clearProductQueryCache();
      }
      previousAuthUserIdRef.current = nextUserId;
      // A refreshed token for the same member in the same chapter: retry what
      // the API refused while the old one was lapsing (`noteRefreshedSignInToken`).
      // A chapter switch also refreshes the token, but its refetch has to wait
      // for the new chapter id to commit (`lib/frapp-client.tsx`), and the
      // chapter change's cache clear does it.
      const nextToken = nextSession?.access_token ?? null;
      const previousToken = previousAccessTokenRef.current;
      previousAccessTokenRef.current = nextToken;
      if (
        nextToken &&
        previousToken &&
        nextToken !== previousToken &&
        previousUserId === nextUserId &&
        chapterClaimOf(nextToken) === chapterClaimOf(previousToken)
      ) {
        noteRefreshedSignInToken();
      }
      setSession(nextSession ?? null);
      setStatus(nextSession ? "authenticated" : "unauthenticated");
      if (opts.clearCallbackError && nextSession) setCallbackError(null);
    };

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        applySession(data.session ?? null, { clearCallbackError: false });
      })
      .catch(() => {
        if (!cancelled) setStatus("unauthenticated");
      });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (cancelled) return;
      applySession(nextSession ?? null, { clearCallbackError: true });
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  // Mirror the access token into SecureStore under the key the API SDK already
  // reads (`AUTH_TOKEN_STORAGE_KEY`). This is the whole seam: the SDK client
  // stays unaware of Supabase, and every refreshed token propagates for free.
  // Skip hydrating: first paint has no session yet and must not `clearAuthToken`
  // (that would poison the in-process token before `getSession` resolves).
  useEffect(() => {
    if (status === "hydrating") return;
    if (accessToken) {
      void writeAuthToken(accessToken);
    } else {
      void clearAuthToken();
    }
  }, [accessToken, status]);

  // Chapter context comes from the token claim, never from a local pick
  // (`chapterId` above). Per `spec/behavior/multi-tenancy.md` the claim is
  // authoritative and `x-chapter-id` only a fallback, and the API rejects
  // every request with 403 `chapter.context.mismatch` when they disagree, so
  // reading the claim makes disagreement impossible by construction. `null` is
  // a safe resolution, not a failure: the API resolves a sole membership
  // server-side when no claim is present (`lib/auth-gate.ts`). Selecting a
  // chapter goes through `lib/select-chapter.ts`, which activates server-side
  // and refreshes the session; the new token's claim is the new chapter.

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

  // Magic-link and OAuth callbacks: the link opens the app with tokens attached.
  useEffect(() => {
    if (!supabase || !url) return;
    if (lastHandledCallbackUrl.current === url) return;

    let cancelled = false;
    lastHandledCallbackUrl.current = url;
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
      if (error) {
        reportAuthFailure({
          flow: "password_sign_in",
          screen: "/sign-in",
          error,
        });
        throw error;
      }
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
        options: { emailRedirectTo: appRedirectTo() },
      });
      if (error) {
        reportAuthFailure({
          flow: "magic_link_send",
          screen: "/sign-in",
          error,
        });
        throw error;
      }
    },
    [supabase],
  );

  const verifyEmailCode = useCallback(
    async ({ email, code }: { email: string; code: string }) => {
      if (!supabase) throw new Error(NOT_CONFIGURED_MESSAGE);
      setCallbackError(null);
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });
      if (error) {
        // A mistyped code is the member's, not a failure to report.
        if (!describeEmailCodeError(error).wrongCode) {
          reportAuthFailure({
            flow: "email_code_verify",
            screen: "/join",
            error,
          });
        }
        throw error;
      }
    },
    [supabase],
  );

  const resendConfirmation = useCallback(
    async ({ email }: { email: string }) => {
      if (!supabase) throw new Error(NOT_CONFIGURED_MESSAGE);
      setCallbackError(null);
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: appRedirectTo() },
      });
      if (error) {
        reportAuthFailure({
          flow: "confirmation_resend",
          screen: "/sign-in",
          error,
        });
        throw error;
      }
    },
    [supabase],
  );

  const signInWithOAuthProvider = useCallback(
    async (provider: OAuthProvider) => {
      // Each failure below is reported once, here, as `oauth_start` with the
      // error it came from (#3832). A return that reached the app but didn't
      // become a session was already reported by `createSessionFromUrl` as
      // `auth_callback`, so its rethrow is not reported again. A cancel is
      // not a failure.
      const startFailed = (error: unknown): unknown => {
        reportAuthFailure({ flow: "oauth_start", screen: "/sign-in", error });
        return error;
      };
      if (!supabase) throw startFailed(new Error(NOT_CONFIGURED_MESSAGE));
      setCallbackError(null);

      let native: "completed" | "cancelled" | "unavailable" = "unavailable";
      try {
        if (provider === "apple") {
          native = await signInWithNativeApple(supabase);
        } else if (provider === "google") {
          native = await signInWithNativeGoogle(supabase);
        }
      } catch (error) {
        throw startFailed(error);
      }
      if (native === "cancelled") return;
      if (native === "completed") {
        return;
      }

      const redirectTo = appRedirectTo();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          queryParams:
            provider === "google" ? { prompt: "select_account" } : undefined,
        },
      });
      if (error) {
        startFailed(error);
        throw Object.assign(
          new MemberFacingError(describeOAuthKickoffError(error)),
          { code: error.code },
        );
      }
      if (!data.url) {
        throw startFailed(new MemberFacingError(START_FAILED_COPY));
      }

      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        redirectTo,
      );
      if (result.type === "cancel" || result.type === "dismiss") return;
      if (result.type !== "success") {
        throw startFailed(new MemberFacingError(FINISH_FAILED_COPY));
      }

      // `openAuthSessionAsync` returning success and `Linking.useURL`
      // delivering the same URL are the same event on iOS. Claim the URL
      // synchronously before any await so the Linking effect cannot start a
      // second exchange of a single-use `code`. If Linking already claimed it,
      // the session (or callbackError) is already in flight — do not throw a
      // stale "invalid code" over a sign-in that succeeded.
      if (lastHandledCallbackUrl.current === result.url) {
        return;
      }
      lastHandledCallbackUrl.current = result.url;
      const message = await createSessionFromUrl(supabase, result.url);
      if (message) {
        throw new MemberFacingError(message);
      }
    },
    [supabase],
  );

  const signOut = useCallback(async () => {
    try {
      if (supabase) {
        await supabase.auth.signOut();
      }
    } catch {
      // Never propagate. Callers navigate away on return (`preferences.tsx`), so a
      // thrown network error would strand the member on an authenticated screen
      // while the local session below is already gone.
    }

    // Always clear locally, even when the remote revoke failed — a token left
    // in SecureStore would keep the SDK sending a Bearer header for a session
    // the member believes they ended.
    await clearAuthToken();
    // Drop every cached query on the way out, for every sign-out path.
    //
    // Mobile's `QueryClient` is a module singleton, and the rest of this
    // function clears only SecureStore and React state — so without this the
    // next member to sign in on the same device is served the previous one's
    // rows until each entry goes stale. Several keys are not account-scoped at
    // all (`["settings"]`, `["user","me"]`), so they would never re-key their
    // way out of it.
    //
    // This lives here rather than in the screens because every screen that
    // signs out calls this `signOut`, and when each had to remember the clear
    // for itself the picker's landed only after the leak was noticed a second
    // time. Owning it at this single funnel is what stops the next screen that
    // signs out from reintroducing it. An in-place uid swap uses the same
    // helper from `applySession` so it cannot forget the drop either.
    clearProductQueryCache();
    previousAuthUserIdRef.current = null;
    setSession(null);
    setStatus("unauthenticated");
    resetObservabilityOnLogout();
  }, [supabase]);

  // Signed in with no token yet: the claim can't be read. Decoding is
  // synchronous, so this is false on the same render the session arrives.
  const isChapterResolving = status === "authenticated" && !accessToken;

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      status,
      email: session?.user?.email ?? null,
      userId,
      chapterId,
      isChapterResolving,
      isConfigured: configured,
      callbackError,
      signInWithPassword,
      sendMagicLink,
      verifyEmailCode,
      resendConfirmation,
      signInWithOAuthProvider,
      signOut,
    }),
    [
      callbackError,
      chapterId,
      configured,
      isChapterResolving,
      resendConfirmation,
      sendMagicLink,
      session?.user?.email,
      signInWithPassword,
      signInWithOAuthProvider,
      signOut,
      status,
      userId,
      verifyEmailCode,
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
