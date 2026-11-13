// No "use client": this runs in the `/auth/callback` route handler and the
// `/new-account` server component. It reads the backend API from the server,
// so it must never be bundled into the browser.

/**
 * Deciding whether a magic-link sign-in just created a brand-new, empty
 * account (#3801).
 *
 * The sign-in screen's magic link calls `signInWithOtp` without
 * `shouldCreateUser: false`, and supabase-js defaults that to `true`. So a
 * member who types an email they never joined with gets a fresh account
 * outside any chapter, with nothing on screen to say so — the email twin of
 * the OAuth split #3786 fixed. Paul chose option 2 on the issue: let the
 * account be created, then tell the member on `/new-account`, the same page the
 * OAuth path uses.
 *
 * `isFirstOAuthSignIn` can't be reused: it compares `created_at` with
 * `last_sign_in_at`, and a magic-link account is created when the link is
 * *requested* and first signed into when it is *opened*, so those timestamps
 * are minutes or hours apart for a legitimately new account too. The signal
 * here is instead structural: the account's only identity is `email` (no Google
 * or Apple attached) **and** it belongs to no chapter.
 *
 * The chapter read is the only thing that keeps a real member from being
 * flagged: an existing password or magic-link member also has only an `email`
 * identity, but they belong to a chapter. If that read can't be made (API down
 * or slow), this returns `false` — a member is signed in rather than stranded,
 * which is the fail-open Paul asked for. The cost is that the rare genuine new
 * account slips through on an outage, which is the pre-#3801 behavior.
 */

type IdentityUser = {
  identities?: Array<{ provider?: string | null } | null> | null;
};

/** How long to wait on the chapters read before falling open to sign-in. */
export const CHAPTERS_READ_TIMEOUT_MS = 4000;

/**
 * True when the account's only sign-in identity is `email` — no Google or
 * Apple is attached. A brand-new magic-link account has exactly this; so does
 * an existing email member, which is why {@link isNewEmailAccount} also reads
 * the chapters. An account with any OAuth identity is out of scope here (the
 * OAuth path owns #3786), and an empty or absent identity list is treated as
 * "can't tell", i.e. not flagged.
 */
export function isEmailOnlyAccount(
  user: IdentityUser | null | undefined,
): boolean {
  if (!user || !Array.isArray(user.identities) || user.identities.length === 0) {
    return false;
  }
  return user.identities.every((identity) => identity?.provider === "email");
}

/**
 * The API base the generated SDK uses, without a trailing `/v1`. Mirrors
 * `normalizeApiBaseUrl` in `@repo/api-sdk`; kept local so this server-only
 * module pulls in no client SDK.
 */
function apiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
  return raw.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
}

/**
 * Whether the caller belongs to any chapter, read from `GET /v1/chapters`
 * (`chapterService.listForUser` → `[]` for no memberships). Returns:
 * - `true`  — at least one membership;
 * - `false` — none;
 * - `null`  — the read couldn't be made (non-OK status, bad body, timeout,
 *   network error). Callers treat `null` as "don't flag", so an API outage
 *   never blocks a sign-in.
 */
async function hasAnyChapterMembership(
  accessToken: string,
): Promise<boolean | null> {
  try {
    const response = await fetch(`${apiBaseUrl()}/v1/chapters`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(CHAPTERS_READ_TIMEOUT_MS),
    });
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
 * (#3801): its only identity is `email` and `GET /v1/chapters` reports no
 * membership. A read that can't be made falls open to `false`, so sign-in is
 * never blocked by it.
 */
export async function isNewEmailAccount(
  user: IdentityUser | null | undefined,
  accessToken: string | null | undefined,
): Promise<boolean> {
  if (!accessToken || !isEmailOnlyAccount(user)) return false;
  const hasChapter = await hasAnyChapterMembership(accessToken);
  return hasChapter === false;
}
