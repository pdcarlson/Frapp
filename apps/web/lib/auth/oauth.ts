import { describeOAuthError } from "@repo/hooks/auth-error-copy";
import {
  type AuthCallbackIntent,
  buildAuthCallbackUrl,
  describeAuthError,
} from "@/lib/auth/redirect";

export type OAuthProvider = "apple" | "google";

const APPLE_PRIVATE_RELAY_HOST = "privaterelay.appleid.com";
const PLACEHOLDER_EMAIL_HOST = "users.invalid";

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

/**
 * A refused Google or Apple start, in the shared auth map's words
 * (`@repo/hooks/auth-error-copy`): never the provider's or GoTrue's sentence.
 */
export function describeOAuthKickoffError(error: unknown): string {
  return describeOAuthError(error, {
    identityCollision: IDENTITY_COLLISION_COPY,
    providerUnavailable: OAUTH_UNAVAILABLE_COPY,
    deadLink: describeAuthError("otp_expired"),
    fallback: "Unable to start sign-in. Retry in a moment.",
  });
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
