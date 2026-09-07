/**
 * The `active_chapter_id` claim of a Supabase access token, or `null`.
 *
 * Decoded, not verified: this value only seeds the browser's chapter selection
 * (which chapter the shell renders for), never an authorisation decision — the
 * API re-reads the same claim from a verified token on every request
 * (`ChapterGuard`, spec/behavior/multi-tenancy.md). The hook that stamps the
 * claim resolves it as the persisted selection while that is still a live
 * membership, else the sole membership, else nothing — so for nearly every
 * member the token already says which chapter they are in.
 */
export function readActiveChapterClaim(token: string | null | undefined): string | null {
  if (!token) return null;
  const segments = token.split(".");
  const payloadSegment = segments[1];
  if (segments.length !== 3 || !payloadSegment) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(payloadSegment)) as {
      active_chapter_id?: unknown;
    };
    const claim = payload.active_chapter_id;
    return typeof claim === "string" && claim.length > 0 ? claim : null;
  } catch {
    return null;
  }
}

function base64UrlDecode(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  // `atob` exists in every browser and in Node ≥ 16, which covers vitest.
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
