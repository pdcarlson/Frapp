/**
 * base64url → UTF-8, the one copy.
 *
 * Two modules in this directory decode Supabase-issued base64url: the access
 * token's claim payload (`active-chapter-claim.ts`) and the `base64-`-prefixed
 * session cookie (`access-token-cookie.ts`). They had a byte-identical five
 * line decoder each, which is two places for a padding or multi-byte fix to
 * land in one of — and because both callers turn a throw into `null` by design,
 * the symptom of that divergence is not an error but one of the two paths
 * silently never resolving, with both their specs green.
 */

/** Throws on malformed input; every caller here catches and treats it as absent. */
export function base64UrlDecode(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  // `atob` exists in every browser and in Node ≥ 16, which covers vitest and
  // the Next server runtime these are also read from.
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
