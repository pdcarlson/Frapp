/**
 * Did this sign-in just create a brand-new account? The pure half of the rule
 * behind the "New account created" notice (#3786 Google and Apple, #3801 the
 * magic link on web, #4769 the phone), read only off the signed-in user, so
 * every surface asks the same thing.
 *
 * What it leaves to the caller is the third rule, that the account belongs to
 * no chapter. Web reads `GET /v1/chapters` for it
 * (`apps/web/lib/auth/new-account-detection.ts`); the phone shows the notice
 * only on s02, which the routing gate opens only for an account whose
 * chapters read answered `[]` (`apps/mobile/lib/auth-gate.ts`).
 *
 * Anything missing or unparseable reads as "not new", so a sign-in is never
 * held up by the notice.
 */

/** The fields of a Supabase `User` the rule reads. */
export type NewAccountUser = {
  identities?: ReadonlyArray<{ provider?: string | null } | null> | null;
  created_at?: string | null;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  app_metadata?: { provider?: unknown } | null;
};

const NEW_ACCOUNT_OAUTH_PROVIDERS: readonly string[] = ["apple", "google"];

/**
 * How close two auth timestamps must be to count as the same sign-in. With
 * PKCE, GoTrue creates the user at its provider callback and writes
 * `last_sign_in_at` only when the app exchanges the code, normally a second or
 * two apart; a slow phone or network can stretch that, so the window is
 * generous. A returning member's `created_at` is days or months old.
 */
export const FIRST_SIGN_IN_WINDOW_MS = 5 * 60_000;

/**
 * The longest an email link can live: GoTrue caps the OTP expiry at 86400s. A
 * new magic-link account is created when the link is asked for and confirmed
 * when it's opened, so no later than this.
 */
export const EMAIL_LINK_MAX_AGE_MS = 24 * 60 * 60_000;

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * True when this Google or Apple sign-in created the account (#3786): the
 * account was made by that provider (`app_metadata.provider`, set from its
 * first identity) and its first sign-in is this one. A Google identity GoTrue
 * auto-linked onto an older email account keeps the old `created_at`, so it
 * isn't flagged.
 */
export function isFirstOAuthSignIn(
  user: NewAccountUser | null | undefined,
): boolean {
  const provider = user?.app_metadata?.provider;
  if (
    typeof provider !== "string" ||
    !NEW_ACCOUNT_OAUTH_PROVIDERS.includes(provider)
  ) {
    return false;
  }
  const created = timestamp(user?.created_at);
  const signedIn = timestamp(user?.last_sign_in_at);
  if (created === null || signedIn === null) return false;
  return Math.abs(signedIn - created) <= FIRST_SIGN_IN_WINDOW_MS;
}

/**
 * True when the account's only sign-in identity is `email`. An empty or absent
 * identity list is "can't tell", so not flagged.
 */
export function isEmailOnlyAccount(
  user: NewAccountUser | null | undefined,
): boolean {
  const identities = user?.identities;
  if (!Array.isArray(identities) || identities.length === 0) return false;
  return identities.every((identity) => identity?.provider === "email");
}

/**
 * True when this sign-in is the one that confirmed the address, on an account
 * no older than an email link lives. `created_at` and `last_sign_in_at` can't
 * tell a new magic-link account from an old one (it's created when the link is
 * asked for), but hosted projects require confirmation (#3776), so GoTrue
 * stamps `email_confirmed_at` when the new account's first link is opened. An
 * older account, such as one waiting on an invite or removed from its chapter,
 * confirmed its address long ago and fails this.
 */
export function isConfirmedByThisSignIn(
  user: NewAccountUser | null | undefined,
): boolean {
  const created = timestamp(user?.created_at);
  const confirmed = timestamp(user?.email_confirmed_at);
  const signedIn = timestamp(user?.last_sign_in_at);
  if (created === null || confirmed === null || signedIn === null) return false;
  return (
    Math.abs(signedIn - confirmed) <= FIRST_SIGN_IN_WINDOW_MS &&
    confirmed - created <= EMAIL_LINK_MAX_AGE_MS
  );
}

/**
 * Rules 1 and 2 for an email account (#3801): an email-only account whose
 * address this sign-in confirmed. Only meaningful for a sign-in that came from
 * the sign-in screen's magic link: a sign-up confirmation passes it too, and
 * isn't news to the person who just signed up.
 */
export function isNewEmailSignIn(
  user: NewAccountUser | null | undefined,
): boolean {
  return isEmailOnlyAccount(user) && isConfirmedByThisSignIn(user);
}
