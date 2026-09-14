/**
 * The Supabase access token, read straight out of the request's cookies.
 *
 * ## Why not `createSupabaseServerClient().auth.getSession()`
 *
 * Because this runs in the `(dashboard)` layout, in front of every dashboard
 * render, for the sole purpose of choosing a colour. `getSession()` is the
 * supported way to read a session server-side, but it will **refresh an expired
 * token**, which is a network round trip to the auth server — and a member
 * returning after an hour away is exactly the cold load this whole path exists
 * to make fast. Blocking time-to-first-byte on an auth call to avoid a flash
 * would be a strictly worse trade than the flash.
 *
 * So the cookies are read directly and the token is used **decoded, never
 * verified** (`active-chapter-claim.ts` states the ceiling that puts on it). No
 * network, no async work beyond `cookies()` itself, and nothing here can make a
 * request slower than it was before.
 *
 * ## The format, and what happens when it moves
 *
 * `@supabase/ssr` writes the session JSON under `sb-<project-ref>-auth-token`,
 * splitting it across `.0`, `.1`, … when it exceeds its chunk size, and
 * prefixes the value with `base64-` when it is base64url-encoded
 * (`node_modules/@supabase/ssr/dist/main/cookies.js`). None of that is a public
 * export, so it is reimplemented here rather than imported.
 *
 * That makes this the one part of the accent cache that can rot silently if
 * Supabase changes its storage format. It is written to fail closed for exactly
 * that reason: every branch returns `null`, `null` means "no cached accent",
 * and no cached accent is the behaviour that shipped before this existed — one
 * ordinary cold load. A format change costs the optimisation, never
 * correctness, and never an error. `access-token-cookie.spec.ts` pins each
 * shape so the day it does move is a red test rather than a silent regression.
 */

const BASE64_PREFIX = "base64-";

/**
 * `sb-<ref>-auth-token`, optionally with a `.<n>` chunk suffix.
 *
 * Deliberately not anchored to a known project ref: the ref differs per
 * environment (local, staging, production) and is not worth threading through
 * from env just to re-derive a name the cookie already carries.
 *
 * The PKCE code-verifier keys Supabase stores alongside the session
 * (`…-code-verifier`, `…-flows-code-verifier`, `…-flow-<id>-code-verifier`) all
 * end in `-code-verifier` rather than `-auth-token`, so this cannot match one.
 */
const AUTH_COOKIE = /^sb-[A-Za-z0-9_-]+-auth-token(?:\.(\d+))?$/;

export interface RequestCookie {
  name: string;
  value: string;
}

/**
 * The access token from a cookie jar, or `null`.
 *
 * `null` for every failure: no auth cookie, chunks that do not reassemble,
 * a value that is not JSON, JSON with no `access_token`. See the header for why
 * that is the only sensible failure mode here.
 */
export function readAccessTokenFromCookies(
  cookies: readonly RequestCookie[],
): string | null {
  const chunks: Array<{ index: number; value: string }> = [];
  for (const cookie of cookies) {
    const match = AUTH_COOKIE.exec(cookie.name);
    if (!match) continue;
    /*
      An unchunked cookie sorts as chunk 0 so both shapes take one code path.
      A jar holding both (a session that shrank below the chunk threshold and
      left `.0` behind, say) would concatenate them — hence `session`, which
      takes the unchunked value alone when one is present.
    */
    chunks.push({
      index: match[1] === undefined ? -1 : Number(match[1]),
      value: cookie.value,
    });
  }
  if (chunks.length === 0) return null;

  const unchunked = chunks.find((chunk) => chunk.index === -1);
  const session = unchunked
    ? unchunked.value
    : chunks
        .sort((a, b) => a.index - b.index)
        .map((chunk) => chunk.value)
        .join("");

  const decoded = decodeSessionValue(session);
  if (decoded === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  /*
    Two shapes have shipped under this cookie: the session object, and an array
    whose first element is the access token. Both are read, because a browser
    holding the older one is a browser mid-upgrade, not a browser to break.
  */
  if (Array.isArray(parsed)) {
    const first: unknown = parsed[0];
    return typeof first === "string" && first.length > 0 ? first : null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const token = (parsed as { access_token?: unknown }).access_token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

function decodeSessionValue(value: string): string | null {
  if (!value.startsWith(BASE64_PREFIX)) return value;
  const encoded = value.slice(BASE64_PREFIX.length);
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}
