// No "use client": this runs in the `/auth/callback` route handler and the
// `/new-account` server component. It reads the backend API from the server
// with the member's own token, so it must never be bundled into the browser.

import { normalizeApiBaseUrl, withRequestIdInit } from "@repo/api-sdk";
import { FIRST_SIGN_IN_WINDOW_MS, isFirstOAuthSignIn } from "@/lib/auth/oauth";

/**
 * Deciding whether a sign-in from the sign-in screen just created a brand-new,
 * empty account, so `/new-account` can say so (#3786 for Google and Apple,
 * #3801 for the magic link). The callback and the page both ask
 * {@link isNewAccount}, so they can't drift apart.
 *
 * **Why the magic link needs its own rule.** `signInWithOtp` creates an
 * account for an unknown email by default, so a member who types an email they
 * never joined with lands in a fresh one outside their chapter. Paul chose
 * "detect and notify" on #3801. `isFirstOAuthSignIn` can't be reused: it
 * compares `created_at` with `last_sign_in_at`, and a magic-link account is
 * created when the link is *requested* and first signed into when it is
 * *opened*, minutes or hours later.
 *
 * **The rule.** All three must hold:
 * 1. The account's only identity is `email` (no Google or Apple attached).
 * 2. This sign-in is the one that confirmed the address: `email_confirmed_at`
 *    is within {@link FIRST_SIGN_IN_WINDOW_MS} of `last_sign_in_at`, and no
 *    more than {@link EMAIL_LINK_MAX_AGE_MS} after `created_at` (the longest
 *    an email link lives). Hosted projects require that confirmation (#3776),
 *    so GoTrue stamps it when the new account's first link is opened. An older
 *    account confirmed its address long ago and fails this, which is what keeps
 *    a returning chapterless account (one waiting on an invite, or removed from
 *    its chapter) from being told it is new.
 * 3. It belongs to no chapter: `GET /v1/chapters` answers `[]`. This keeps a
 *    member who joined in the last few minutes from being flagged.
 *
 * Any doubt falls open to "not new", so a sign-in is never blocked: a read
 * that fails, times out (`CHAPTERS_READ_TIMEOUT_MS`) or answers something odd,
 * a missing token, or missing timestamps. The cost is that a genuinely new
 * account slips through, which is the pre-#3801 behavior. On a local stack
 * that confirms addresses as it creates them (`enable_confirmations = false`),
 * rule 2 only matches a link opened within five minutes of asking for it.
 */

type DetectionUser = {
  identities?: Array<{ provider?: string | null } | null> | null;
  created_at?: string | null;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  app_metadata?: { provider?: unknown } | null;
};

/** How long to wait on the chapters read before falling open to sign-in. */
export const CHAPTERS_READ_TIMEOUT_MS = 4000;

/**
 * The longest an email link can live: GoTrue caps the OTP expiry at 86400s.
 * A brand-new magic-link account is confirmed no later than this after it was
 * created (when the link was asked for).
 */
export const EMAIL_LINK_MAX_AGE_MS = 24 * 60 * 60_000;

/**
 * True when the account's only sign-in identity is `email`. An empty or absent
 * identity list is "can't tell", so not flagged.
 */
export function isEmailOnlyAccount(user: DetectionUser | null | undefined): boolean {
  if (!user || !Array.isArray(user.identities) || user.identities.length === 0) {
    return false;
  }
  return user.identities.every((identity) => identity?.provider === "email");
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * True when this sign-in is the one that confirmed the address, on an account
 * no older than an email link lives (rule 2 above).
 */
export function isConfirmedByThisSignIn(user: DetectionUser | null | undefined): boolean {
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
 * Whether the caller belongs to any chapter, from `GET /v1/chapters`
 * (`chapterService.listForUser`, `[]` for none). `null` when the read can't
 * be made or answers something unexpected; callers treat that as "don't flag".
 */
async function hasAnyChapterMembership(accessToken: string): Promise<boolean | null> {
  try {
    const base = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001");
    const response = await fetch(
      `${base}/v1/chapters`,
      withRequestIdInit({
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal: AbortSignal.timeout(CHAPTERS_READ_TIMEOUT_MS),
      }),
    );
    if (!response.ok) return null;
    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) return null;
    return body.length > 0;
  } catch {
    return null;
  }
}

/**
 * True when this sign-in landed in a brand-new, chapterless email account
 * (#3801; rules 1 to 3 above). The chapters read is made only when rules 1 and
 * 2 already hold, so a returning member costs no API call.
 */
export async function isNewEmailAccount(
  user: DetectionUser | null | undefined,
  accessToken: string | null | undefined,
): Promise<boolean> {
  if (!accessToken || !isEmailOnlyAccount(user) || !isConfirmedByThisSignIn(user)) {
    return false;
  }
  return (await hasAnyChapterMembership(accessToken)) === false;
}

/**
 * The one "did this sign-in create a new account?" question the callback and
 * `/new-account` both ask: a new Google or Apple account (#3786, timestamps) or
 * a new chapterless email account (#3801). The two are exclusive by identity,
 * so either path can ask both.
 */
export async function isNewAccount(
  user: DetectionUser | null | undefined,
  accessToken: string | null | undefined,
): Promise<boolean> {
  return isFirstOAuthSignIn(user) || (await isNewEmailAccount(user, accessToken));
}
