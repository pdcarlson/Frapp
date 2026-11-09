import { type AuthCallbackIntent, buildAuthCallbackUrl } from "@/lib/auth/redirect";

export const OAUTH_PROVIDERS = ["apple", "google"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const APPLE_PRIVATE_RELAY_HOST = "privaterelay.appleid.com";
const PLACEHOLDER_EMAIL_HOST = "users.invalid";

const IDENTITY_COLLISION_CODES = new Set([
  "identity_already_exists",
  "user_already_exists",
  "email_exists",
]);

/**
 * Member-facing copy when GoTrue will not auto-link a new OAuth identity onto
 * an existing email/password or magic-link user.
 *
 * Automatic linking is a hosted Auth setting (Ops checklist). When it is on,
 * this path is rare. When it is off, guessing a merge in `public.users` would
 * attach two auth ids to one chapter member — so we send them back to the
 * method that already owns that email.
 */
export const IDENTITY_COLLISION_COPY =
  "An account with this email already exists. Sign in with your password or a magic link. Google or Apple can attach to that same account on later visits.";

export const OAUTH_UNAVAILABLE_COPY =
  "This sign-in method isn't available yet. Use your password or a magic link.";

export const OAUTH_MEMBERSHIP_HINT =
  "Invited at a university address? Open that link after you sign in. Membership follows this account, including Apple Hide My Email.";

export function isApplePrivateRelayEmail(
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  const host = email.split("@")[1]?.toLowerCase();
  return host === APPLE_PRIVATE_RELAY_HOST;
}

export function isPlaceholderAuthEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const host = email.split("@")[1]?.toLowerCase();
  return host === PLACEHOLDER_EMAIL_HOST;
}

export function isIdentityCollisionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? error.code : undefined;
  if (typeof code === "string" && IDENTITY_COLLISION_CODES.has(code)) {
    return true;
  }
  const message = "message" in error ? error.message : undefined;
  if (typeof message !== "string") return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("already been registered") ||
    lower.includes("already registered") ||
    lower.includes("identity already exists")
  );
}

export function describeOAuthKickoffError(error: unknown): string {
  if (isIdentityCollisionError(error)) return IDENTITY_COLLISION_COPY;
  const message =
    error && typeof error === "object" && "message" in error
      ? error.message
      : undefined;
  if (typeof message === "string" && message.trim().length > 0) {
    const lower = message.toLowerCase();
    if (
      lower.includes("provider is not enabled") ||
      lower.includes("unsupported provider")
    ) {
      return OAUTH_UNAVAILABLE_COPY;
    }
    return message;
  }
  return "Unable to start sign-in. Retry in a moment.";
}

/**
 * Kick off Google or Apple on the browser client.
 *
 * `redirectTo` is the post-auth path (already open-redirect guarded). The
 * OAuth return lands on `/auth/callback?next=…`, the same PKCE `code` exchange
 * magic-link confirmations already use — so this must not invent a second
 * callback route. The sign-in screen passes `intent: "sign-in"` so the
 * callback can tell a member who landed in a brand-new account (#3786).
 */
export async function startWebOAuth(
  supabase: {
    auth: {
      signInWithOAuth: (credentials: {
        provider: OAuthProvider;
        options?: {
          redirectTo?: string;
          queryParams?: Record<string, string>;
        };
      }) => Promise<{ error: { message: string; code?: string } | null }>;
    };
  },
  provider: OAuthProvider,
  origin: string,
  redirectTo: string,
  intent?: AuthCallbackIntent,
): Promise<{ error: { message: string; code?: string } | null }> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: buildAuthCallbackUrl(origin, redirectTo, { intent }),
      queryParams:
        provider === "google" ? { prompt: "select_account" } : undefined,
    },
  });
  if (!error) return { error: null };
  return {
    error: { message: error.message, code: error.code },
  };
}

/**
 * How close `created_at` and `last_sign_in_at` must be for the session to be
 * the account's first. GoTrue writes both in the same request when an OAuth
 * callback creates the user; a returning member's `created_at` is days or
 * months old. A minute leaves room for clock skew between Auth's writes.
 */
const FIRST_SIGN_IN_WINDOW_MS = 60_000;

type FirstSignInUser = {
  created_at?: string | null;
  last_sign_in_at?: string | null;
  app_metadata?: { provider?: unknown } | null;
};

/**
 * True when this OAuth sign-in just created the account (#3786).
 *
 * GoTrue does not hand the `user_signedup` event to the code exchange, so this
 * reads it off the user: the account was created by Google or Apple
 * (`app_metadata.provider`, set from the first identity) and its first sign-in
 * is this one. A member whose Google identity GoTrue auto-linked onto an older
 * account by verified email keeps the old `created_at` and is not flagged.
 */
export function isFirstOAuthSignIn(
  user: FirstSignInUser | null | undefined,
): boolean {
  if (!user) return false;
  const provider = user.app_metadata?.provider;
  if (
    typeof provider !== "string" ||
    !(OAUTH_PROVIDERS as readonly string[]).includes(provider)
  ) {
    return false;
  }
  if (!user.created_at || !user.last_sign_in_at) return false;
  const created = Date.parse(user.created_at);
  const signedIn = Date.parse(user.last_sign_in_at);
  if (Number.isNaN(created) || Number.isNaN(signedIn)) return false;
  return Math.abs(signedIn - created) <= FIRST_SIGN_IN_WINDOW_MS;
}
