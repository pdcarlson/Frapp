import { buildAuthCallbackUrl } from "@/lib/auth/redirect";

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
 * callback route.
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
): Promise<{ error: { message: string; code?: string } | null }> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: buildAuthCallbackUrl(origin, redirectTo),
      queryParams:
        provider === "google" ? { prompt: "select_account" } : undefined,
    },
  });
  if (!error) return { error: null };
  return {
    error: { message: error.message, code: error.code },
  };
}
