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
function authCodeOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error))
    return undefined;
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

/**
 * GoTrue's one-email-a-minute window. A Resend waits it out after a send, so
 * the member never meets the refusal by tapping again right away.
 */
export const EMAIL_RESEND_COOLDOWN_SECONDS = 60;

/** GoTrue's email code is six digits unless a project changed it. */
export const EMAIL_CODE_LENGTH = 6;

/**
 * Continue with email on the invite card, web and phone alike (#5625): the
 * address, then the code from the email typed in place. The same email also
 * carries a sign-in link, which works until the Auth templates print the code,
 * and on another device.
 */
export const EMAIL_CODE_COPY = {
  sendLabel: "Send code",
  sentTitle: "Check your email",
  sent: (email: string) =>
    `We sent a ${EMAIL_CODE_LENGTH}-digit code to ${email}. Enter it here, or tap the link in the email.`,
  wrongCode: "That code didn't work. Use the newest email, or send a new code.",
  invalidEmail: "Enter the email you use for school or your chapter.",
  differentEmail: "Use a different email",
  sendAgain: "Send a new code",
  sendAgainIn: (seconds: number) => `Send again in ${seconds}s`,
} as const;

/**
 * What a failed code check says (#5625), and whether the code itself was the
 * problem. GoTrue answers a wrong or expired code with `otp_expired` (a 403)
 * or a 400; only then is the field cleared. Anything else (offline, too many
 * tries, an Auth outage) is not the member's code, so it says what happened
 * and keeps the code for another try.
 */
export function describeEmailCodeError(error: unknown): {
  message: string;
  wrongCode: boolean;
} {
  const status = statusOf(error);
  if (
    authCodeOf(error) === "otp_expired" ||
    status === 400 ||
    status === 401 ||
    status === 403
  ) {
    return { message: EMAIL_CODE_COPY.wrongCode, wrongCode: true };
  }
  return { message: authFallbackCopy(error), wrongCode: false };
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
  if (authCodeOf(error) === "invalid_credentials")
    return WRONG_CREDENTIALS_COPY;
  return describeEmailSendError(error);
}

/** Email links are switched off for the project: retrying can't help. */
export const EMAIL_LINKS_OFF_COPY =
  "Email links are switched off right now. Sign in with your password.";

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
  const code = authCodeOf(error);
  if (code === "email_address_invalid") return "Enter a valid email address.";
  if (code === "otp_disabled") return EMAIL_LINKS_OFF_COPY;
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
      error &&
      typeof error === "object" &&
      "reasons" in error &&
      Array.isArray(error.reasons)
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
  return Boolean(
    user && Array.isArray(user.identities) && user.identities.length === 0,
  );
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
function isProviderUnavailableError(error: unknown): boolean {
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
function isDeadEmailLink(error: unknown): boolean {
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
 * - No answer from GoTrue (auth-js's `AuthRetryableFetchError` with status 0,
 *   or a `fetch` failure with no status) is a dropped connection. A gateway
 *   5xx is not.
 * - A 429 is too many tries, whichever limit it was.
 * - Anything else with no status goes through `errorCopy`, which shows a
 *   {@link MemberFacingError} and drops everything else.
 */
export function authFallbackCopy(
  error: unknown,
  fallback: string = AUTH_FALLBACK_COPY,
): string {
  const status = statusOf(error);
  // auth-js also throws `AuthRetryableFetchError` for a GoTrue 502, 503 or
  // 504 with that status: GoTrue's fault, not the member's connection.
  if (
    status === 0 ||
    (status === undefined &&
      error instanceof Error &&
      error.name === "AuthRetryableFetchError")
  ) {
    return OFFLINE_COPY;
  }
  if (status === 429) return STATUS_ERROR_COPY[429]!;
  if (status === undefined) return errorCopy(error, fallback);
  return fallback;
}

/**
 * Shown beside every Continue with Apple button (web's sign-in and sign-up,
 * the phone's s01): an invited
 * member who signs in with Apple's Hide My Email can still redeem an invite
 * sent to a university address, because redeem binds the signed-in user, not
 * the invite's email (`spec/behavior/onboarding.md`). The store's App Review
 * notes rely on this line (`apps/mobile/store/README.md`).
 */
export const OAUTH_MEMBERSHIP_HINT =
  "Invited at a university address? Open that link after you sign in. Membership follows this account, including Apple Hide My Email.";

/**
 * auth-js's `isAuthApiError`, by shape: this package doesn't depend on
 * supabase-js, so it reads the same marker and name the library checks
 * (`__isAuthError` and `name === "AuthApiError"`), as the code readers above
 * read GoTrue's answers by shape.
 */
function isAuthApiErrorShape(
  error: unknown,
): error is { name: "AuthApiError"; status: unknown } {
  return (
    typeof error === "object" &&
    error !== null &&
    "__isAuthError" in error &&
    "name" in error &&
    error.name === "AuthApiError"
  );
}

/**
 * Whether Supabase Auth's answer to `getUser()` means this session is over,
 * on web (`apps/web/lib/auth/rejected-session.ts`) and mobile
 * (`apps/mobile/lib/rejected-session.ts`) alike.
 *
 * The API answers 401 when `SupabaseAuthGuard` rejects the token. With a
 * signed-in tab or device, the usual cause is an account deleted elsewhere:
 * the access token stays valid until it expires, but its user is gone, so
 * every read fails and each screen used to render its own failure for it.
 *
 * Each client asks Auth before acting on the API's word, so a stray 401 never
 * signs a member out. Auth must judge the token to count: an outage (a
 * dropped request, a 5xx, a 429, an unreadable body) is not a verdict. This
 * is stricter than the guard's `isAuthOutage`
 * (`apps/api/src/interface/guards/guard-lookup.ts`): here a wrong "over"
 * signs a member out.
 */
export function isSessionOver(result: {
  data: { user: unknown };
  error: unknown;
}): boolean {
  const { data, error } = result;
  if (!error) return !data.user;
  // Only Auth's own 4xx judges the token. Anything else (a dropped request, a
  // 5xx, a 429, an unreadable body from a proxy in front of Auth, or no local
  // session left to ask about) is not a verdict, and signing out on it would
  // sign every member out during an outage.
  return (
    isAuthApiErrorShape(error) &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  );
}
