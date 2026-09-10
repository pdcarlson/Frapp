export const OAUTH_PROVIDERS = ["apple", "google"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const APPLE_PRIVATE_RELAY_HOST = "privaterelay.appleid.com";

const IDENTITY_COLLISION_CODES = new Set([
  "identity_already_exists",
  "user_already_exists",
  "email_exists",
]);

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
