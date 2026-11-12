import { statusOf } from "@repo/api-sdk";
import { OFFLINE_COPY, STATUS_ERROR_COPY } from "@repo/validation";
import { errorCopy, MemberFacingError } from "./error-copy";

/**
 * What a member reads when Supabase Auth (GoTrue) refuses a sign-in, a
 * sign-up, an email send, or an email link, on web and mobile alike
 * (`spec/ui/design-system/writing.md` § Sign in (pre-auth)).
 *
 * `errorCopy` maps the API's refusals. GoTrue's aren't the API's: it answers
 * with its own `error_code`, which that map has never heard of, and its
 * sentences are written for developers ("Email not confirmed", "For security
 * purposes, you can only request this after 44 seconds."). So every GoTrue
 * refusal is matched here by its code, and by its sentence only where the code
 * alone can't tell (the email minute names its seconds, the hourly cap
 * doesn't) or GoTrue sends no code. GoTrue's sentence is never shown.
 *
 * Web read these as "Something went wrong" until #3831 (2026-11-09), and
 * mobile read GoTrue's raw sentences until #3833: the first screen a new
 * tester sees.
 */

/** The fallback when nothing more specific is known. */
export const AUTH_FALLBACK_COPY = "Something went wrong. Please try again.";

/** GoTrue's `error_code` on an `AuthApiError`, or undefined. */
export function authCodeOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" && error.code.length > 0
    ? error.code
    : undefined;
}

function authMessageOf(error: unknown): string {
  if (!error || typeof error !== "object" || !("message" in error)) return "";
  return typeof error.message === "string" ? error.message : "";
}

/**
 * The account exists and its password matched, but its address was never
 * confirmed. Hosted projects require confirmation (#3776), so this is what
 * every new password account meets until the member opens the confirmation
 * email.
 */
export function isEmailNotConfirmed(error: unknown): boolean {
  if (authCodeOf(error) === "email_not_confirmed") return true;
  return /email not confirmed/i.test(authMessageOf(error));
}

/**
 * GoTrue lets one address be sent one auth email a minute. A second send
 * inside that minute (a magic link right after the confirmation email, a
 * double-tapped Resend) is refused with `429 over_email_send_rate_limit` and a
 * sentence naming the seconds left ("…only request this after 44 seconds").
 * Returns those seconds, or undefined for anything else.
 *
 * Only the sentence tells this apart from the project's hourly send cap, which
 * GoTrue refuses with the same code and no seconds ("Email rate limit
 * exceeded"). That one means no email went out, so it must never read as
 * "we just sent you an email" ({@link isEmailSendCapped}).
 */
export function emailCooldownSeconds(error: unknown): number | undefined {
  if (authCodeOf(error) !== "over_email_send_rate_limit") return undefined;
  const match = /after (\d+) seconds?/i.exec(authMessageOf(error));
  return match ? Number(match[1]) : undefined;
}

/** The project's hourly auth-email cap: nothing was sent, to anyone. */
export function isEmailSendCapped(error: unknown): boolean {
  return (
    authCodeOf(error) === "over_email_send_rate_limit" &&
    emailCooldownSeconds(error) === undefined
  );
}

export const EMAIL_SEND_CAPPED_COPY =
  "We can't send email right now. Too many went out in the last hour. Try again in a few minutes.";

export const UNCONFIRMED_EMAIL_COPY =
  "Confirm your email first. Open the link we sent when you created your account.";

export const WRONG_CREDENTIALS_COPY =
  "That email and password don't match. Check them and try again, or use a magic link instead.";

/** The password form's refusal. */
export function describePasswordSignInError(error: unknown): string {
  if (isEmailNotConfirmed(error)) return UNCONFIRMED_EMAIL_COPY;
  if (authCodeOf(error) === "invalid_credentials") return WRONG_CREDENTIALS_COPY;
  return describeEmailSendError(error);
}

export function cooldownCopy(seconds: number): string {
  const wait =
    seconds > 0
      ? `You can ask for another in ${seconds} second${seconds === 1 ? "" : "s"}.`
      : "You can ask for another in a moment.";
  return `We just sent you an email. Check your inbox and spam folder. ${wait}`;
}

/** A refused email send: magic link, confirmation, or its resend. */
export function describeEmailSendError(error: unknown): string {
  const cooldown = emailCooldownSeconds(error);
  if (cooldown !== undefined) return cooldownCopy(cooldown);
  if (isEmailSendCapped(error)) return EMAIL_SEND_CAPPED_COPY;
  if (authCodeOf(error) === "email_address_invalid") {
    return "Enter a valid email address.";
  }
  return authFallbackCopy(error);
}

/**
 * The sign-up form's refusal. A weak password is the one a member can fix
 * there: hosted projects turn on leaked-password protection, so a common
 * password is refused as well as a short one. `existingAccountCopy` is the
 * surface's identity-collision sentence, which names that surface's controls.
 */
export function describeSignUpError(
  error: unknown,
  existingAccountCopy: string,
): string {
  const code = authCodeOf(error);
  if (code === "weak_password") {
    const reasons =
      error && typeof error === "object" && "reasons" in error && Array.isArray(error.reasons)
        ? (error.reasons as unknown[])
        : [];
    if (reasons.includes("pwned")) {
      return "That password has appeared in a data breach. Choose a different one.";
    }
    if (reasons.includes("characters") && !reasons.includes("length")) {
      return "Choose a stronger password: mix letters, numbers and symbols.";
    }
    return "Choose a longer password: at least 6 characters.";
  }
  if (isIdentityCollisionError(error)) return existingAccountCopy;
  return describeEmailSendError(error);
}

/**
 * Whether a sign-up response is GoTrue's stand-in for an address that already
 * has an account. With confirmations on, GoTrue answers a sign-up for a taken
 * address with a user that has no identities and sends no email, so the
 * member would wait on "Check your email" for a message that never comes.
 */
export function isExistingAccountSignUp(
  user: { identities?: unknown[] | null } | null | undefined,
): boolean {
  return Boolean(user && Array.isArray(user.identities) && user.identities.length === 0);
}

const IDENTITY_COLLISION_CODES = new Set([
  "identity_already_exists",
  "user_already_exists",
  "email_exists",
]);

/** An OAuth sign-in or a sign-up for an address that already has an account. */
export function isIdentityCollisionError(error: unknown): boolean {
  const code = authCodeOf(error);
  if (code && IDENTITY_COLLISION_CODES.has(code)) return true;
  const lower = authMessageOf(error).toLowerCase();
  return (
    lower.includes("already been registered") ||
    lower.includes("already registered") ||
    lower.includes("identity already exists")
  );
}

/** The provider is switched off in the project's Auth settings. */
export function isProviderUnavailableError(error: unknown): boolean {
  const code = authCodeOf(error);
  if (code === "provider_disabled" || code === "oauth_provider_not_supported") {
    return true;
  }
  const lower = authMessageOf(error).toLowerCase();
  return (
    lower.includes("provider is not enabled") ||
    lower.includes("unsupported provider")
  );
}

/**
 * GoTrue's codes for an email link that can't be used any more: expired, or
 * already opened (GoTrue reports both as `otp_expired`, with `access_denied`
 * as the bare `error`).
 */
export function isDeadEmailLink(error: unknown): boolean {
  return authCodeOf(error) === "otp_expired";
}

/**
 * An OAuth start, an OAuth return, or an email link that didn't become a
 * session. Each surface passes the sentences that name its own controls
 * (mobile's email form sits behind "Continue with email"). The provider's or
 * GoTrue's own text is never shown: only a {@link MemberFacingError}'s, which
 * the client wrote for members.
 */
export function describeOAuthError(
  error: unknown,
  copy: {
    identityCollision: string;
    providerUnavailable: string;
    deadLink: string;
    fallback: string;
  },
): string {
  if (error instanceof MemberFacingError) return error.message;
  if (isIdentityCollisionError(error)) return copy.identityCollision;
  if (isProviderUnavailableError(error)) return copy.providerUnavailable;
  if (isDeadEmailLink(error)) return copy.deadLink;
  return authFallbackCopy(error, copy.fallback);
}

/**
 * The last word on an auth failure nothing above recognised. Not `errorCopy`
 * alone: its status lines are the API's ("Your role can't do this", "You've
 * been signed out"), and a GoTrue 401 or 403 before sign-in means neither.
 *
 * - No answer from GoTrue (auth-js's `AuthRetryableFetchError`, status 0, or
 *   a `fetch` failure with no status) is a dropped connection.
 * - A 429 is too many tries, whichever limit it was.
 * - Anything else with no status goes through `errorCopy`, which shows a
 *   {@link MemberFacingError} and drops everything else.
 */
export function authFallbackCopy(
  error: unknown,
  fallback: string = AUTH_FALLBACK_COPY,
): string {
  const status = statusOf(error);
  if (
    status === 0 ||
    (error instanceof Error && error.name === "AuthRetryableFetchError")
  ) {
    return OFFLINE_COPY;
  }
  if (status === 429) return STATUS_ERROR_COPY[429]!;
  if (status === undefined) return errorCopy(error, fallback);
  return fallback;
}
