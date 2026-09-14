/**
 * Claims of a Supabase access token, read without verifying it.
 *
 * Decoded, not verified, and that is a deliberate ceiling on what these values
 * may be used for: they seed **presentation** — which chapter the shell renders
 * for, and which cached accent it is allowed to paint — never an authorisation
 * decision. The API re-reads the same claims from a verified token on every
 * request (`ChapterGuard`, spec/behavior/multi-tenancy.md).
 *
 * A forged token here buys nothing: the worst it can do is make this browser
 * render its own chrome in the wrong colour, which is a thing its owner can do
 * anyway with a stylesheet.
 */

interface AccessTokenClaims {
  sub?: unknown;
  active_chapter_id?: unknown;
}

/** The claim payload, or `null` if this is not a readable JWT. */
function decodeClaims(token: string | null | undefined): AccessTokenClaims | null {
  if (!token) return null;
  const segments = token.split(".");
  const payloadSegment = segments[1];
  if (segments.length !== 3 || !payloadSegment) return null;
  try {
    const payload: unknown = JSON.parse(base64UrlDecode(payloadSegment));
    if (typeof payload !== "object" || payload === null) return null;
    return payload as AccessTokenClaims;
  } catch {
    return null;
  }
}

function readStringClaim(
  token: string | null | undefined,
  name: keyof AccessTokenClaims,
): string | null {
  const claim = decodeClaims(token)?.[name];
  return typeof claim === "string" && claim.length > 0 ? claim : null;
}

/**
 * The `active_chapter_id` claim, or `null`.
 *
 * The hook that stamps the claim resolves it as the persisted selection while
 * that is still a live membership, else the sole membership, else nothing — so
 * for nearly every member the token already says which chapter they are in.
 */
export function readActiveChapterClaim(
  token: string | null | undefined,
): string | null {
  return readStringClaim(token, "active_chapter_id");
}

/**
 * The `sub` claim — the Supabase auth uid — or `null`.
 *
 * The same value `useAuthUserId` reports on the client, which is what makes it
 * usable as the server half of a cache key the client writes
 * (`lib/theme/server-accent.ts`). Not `users.id`; see
 * `lib/chat/first-chunk-cache.ts` for why every cache in this app keys on the
 * auth uid instead.
 */
export function readAuthSubjectClaim(
  token: string | null | undefined,
): string | null {
  return readStringClaim(token, "sub");
}

function base64UrlDecode(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  // `atob` exists in every browser and in Node ≥ 16, which covers vitest and
  // the Next server runtime this is now also read from.
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
