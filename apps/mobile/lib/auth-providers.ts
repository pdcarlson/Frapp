import { describeOAuthError } from "@repo/hooks/auth-error-copy";

export type OAuthProvider = "apple" | "google";

// Mobile s01 keeps the password and magic-link form behind "Continue with
// email" (#3349), so these name that button rather than controls that aren't
// on screen when an OAuth kickoff fails. Web's copy lives in
// `apps/web/lib/auth/oauth.ts`, where the form is always visible.
export const IDENTITY_COLLISION_COPY =
  "An account with this email already exists. Tap Continue with email and sign in with your password or a magic link. Google or Apple can attach to that same account on later visits.";

export const OAUTH_UNAVAILABLE_COPY =
  "This sign-in method isn't available yet. Tap Continue with email to use your password or a magic link.";

/**
 * An email link (magic link or confirmation) that was opened after it expired,
 * or a second time. The form that asks for a new one is behind Continue with
 * email, so this names that button.
 */
export const DEAD_LINK_COPY =
  "That sign-in link has expired or was already used. Tap Continue with email to get a new one.";

export const START_FAILED_COPY = "Unable to start sign-in. Retry in a moment.";
export const FINISH_FAILED_COPY = "Unable to finish sign-in. Retry in a moment.";

const OAUTH_COPY = {
  identityCollision: IDENTITY_COLLISION_COPY,
  providerUnavailable: OAUTH_UNAVAILABLE_COPY,
  deadLink: DEAD_LINK_COPY,
};

/**
 * A refused Google or Apple start, in the shared auth map's words
 * (`@repo/hooks/auth-error-copy`). Never the provider's, the OS's or GoTrue's
 * own sentence (#3833): Apple's native sheet throws
 * "The operation couldn't be completed. (com.apple.AuthenticationServices…)".
 */
export function describeOAuthKickoffError(error: unknown): string {
  return describeOAuthError(error, { ...OAUTH_COPY, fallback: START_FAILED_COPY });
}

/**
 * A magic link, a confirmation link or a provider return that opened the app
 * but didn't become a session. GoTrue puts a sentence in the link
 * ("Email link is invalid or has expired"); only its code is read.
 */
export function describeAuthReturnError(error: unknown): string {
  return describeOAuthError(error, { ...OAUTH_COPY, fallback: FINISH_FAILED_COPY });
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
