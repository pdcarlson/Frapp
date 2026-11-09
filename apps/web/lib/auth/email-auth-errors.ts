import { IDENTITY_COLLISION_COPY, isIdentityCollisionError } from "@/lib/auth/oauth";
import { getErrorMessage } from "@/lib/utils";

/**
 * What a member reads when Supabase Auth refuses an email sign-in, a sign-up,
 * or an email send.
 *
 * `errorCopy` (`@repo/hooks`, behind `getErrorMessage`) maps the API's
 * refusals. GoTrue's aren't the API's: it answers `400` with its own
 * `error_code`, which that map has never heard of, so every one of them fell
 * through to the caller's fallback. On launch day (2026-11-09) a member who had
 * signed up from an invite and not yet opened the confirmation email read
 * "Unable to sign in: Something went wrong" four times running, and a wrong
 * password read the same. GoTrue's codes are stable; its sentences are written
 * for developers, so they are matched by code and never shown.
 */

const FALLBACK = "Something went wrong. Please try again.";

/** GoTrue's `error_code` on an `AuthApiError`, or undefined. */
function authCodeOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function authMessageOf(error: unknown): string {
  if (!error || typeof error !== "object" || !("message" in error)) return "";
  return typeof error.message === "string" ? error.message : "";
}

/**
 * The account exists and its password matched, but its address was never
 * confirmed. Hosted projects require confirmation (#3776), so this is what
 * every web sign-up meets until the member opens the confirmation email.
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
  return getErrorMessage(error, FALLBACK);
}

/**
 * The sign-up form's refusal. A weak password is the one a member can fix
 * here: hosted projects turn on leaked-password protection, so a common
 * password is refused as well as a short one.
 */
export function describeSignUpError(error: unknown): string {
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
  if (isIdentityCollisionError(error)) return EXISTING_ACCOUNT_COPY;
  return describeEmailSendError(error);
}

/**
 * The same sentence an OAuth identity collision reads (`oauth.ts`,
 * `writing.md` § Sign in (pre-auth), the Identity collision row): one fact,
 * one wording.
 */
export const EXISTING_ACCOUNT_COPY = IDENTITY_COLLISION_COPY;

/**
 * Whether a sign-up response is GoTrue's stand-in for an address that already
 * has an account. With confirmations on, GoTrue answers a sign-up for a taken
 * address with a user that has no identities and sends no email, so the
 * member would wait on "Check your email" for a message that never comes.
 */
export function isExistingAccountSignUp(user: { identities?: unknown[] | null } | null | undefined): boolean {
  return Boolean(user && Array.isArray(user.identities) && user.identities.length === 0);
}
