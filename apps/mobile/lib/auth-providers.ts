export const OAUTH_PROVIDERS = ["apple", "google"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const APPLE_PRIVATE_RELAY_HOST = "privaterelay.appleid.com";

const IDENTITY_COLLISION_CODES = new Set([
  "identity_already_exists",
  "user_already_exists",
  "email_exists",
]);

// Mobile s01 keeps the password and magic-link form behind "Continue with
// email" (#3349), so these name that button rather than controls that aren't
// on screen when an OAuth kickoff fails. Web's copy lives in
// `apps/web/lib/auth/oauth.ts`, where the form is always visible.
export const IDENTITY_COLLISION_COPY =
  "An account with this email already exists. Tap Continue with email and sign in with your password or a magic link. Google or Apple can attach to that same account on later visits.";

export const OAUTH_UNAVAILABLE_COPY =
  "This sign-in method isn't available yet. Tap Continue with email to use your password or a magic link.";

/**
 * Shown on s01 wherever a Continue with Apple button is: an invited member who
 * signs in with Apple's Hide My Email can still redeem an invite sent to a
 * university address, because redeem binds the signed-in user, not the
 * invite's email (`spec/behavior/onboarding.md`). The store's App Review notes
 * rely on this line (`apps/mobile/store/README.md`).
 */
export const OAUTH_MEMBERSHIP_HINT =
  "Invited at a university address? Open that link after you sign in. Membership follows this account, including Apple Hide My Email.";

export function isApplePrivateRelayEmail(
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  const host = email.split("@")[1]?.toLowerCase();
  return host === APPLE_PRIVATE_RELAY_HOST;
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
 * Which provider leads, per platform (#3349).
 *
 * The phone's own account comes first: Apple on iOS, Google everywhere else.
 * On iOS both stay on screen, because App Review asks for Sign in with Apple
 * beside any other third-party login (Guideline 4.8). Off iOS, Apple only
 * runs as a browser OAuth page (`lib/apple-auth.ts`), so it moves behind
 * "Other ways to sign in": still there for an account first made with Apple
 * on an iPhone, out of the way for everyone else.
 */
export function signInProviderLayout(os: string): {
  primary: OAuthProvider;
  secondary: OAuthProvider | null;
  tucked: OAuthProvider | null;
} {
  if (os === "ios") {
    return { primary: "apple", secondary: "google", tucked: null };
  }
  return { primary: "google", secondary: null, tucked: "apple" };
}
