/**
 * The Supabase access token, read straight out of the request's cookies.
 *
 * ## Why not `createSupabaseServerClient().auth.getSession()`
 *
 * Not because a refresh would be needed: `proxy.ts` already calls
 * `supabase.auth.getSession()` on every protected route, ahead of the render,
 * and it is the one place that *can* write refreshed cookies back. By the time
 * the `(dashboard)` layout runs, the token in the jar is whatever the proxy
 * settled on.
 *
 * It is because of where a second call would run. A Server Component's cookie
 * store is read-only, so `@supabase/ssr`'s `setAll` is a caught no-op there
 * (`lib/supabase/server.ts` says exactly that) — which means any refresh that
 * client *did* decide to attempt would go out over the network and then be
 * thrown away, once per render, with nothing to show for it. Whether it decides
 * to is a property of supabase-js's internals rather than of this code, and
 * this runs in front of every dashboard render for the sole purpose of choosing
 * a colour. Reading the jar is the version whose cost can be established by
 * reading it: no client, no network, no async work beyond `cookies()`.
 *
 * So the token is used **decoded, never verified** — `active-chapter-claim.ts`
 * states the ceiling that puts on it.
 *
 * The cheaper shape is for `proxy.ts` to pass the uid and chapter it has
 * already resolved down as a request header, which would delete this module
 * outright. That is [#2233](https://github.com/pdcarlson/Frapp/issues/2233), and
 * it is a change to the file that gates all authentication, so it is not
 * smuggled in behind an accent.
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

import { base64UrlDecode } from "./base64url";

const BASE64_PREFIX = "base64-";

/**
 * The cookie name `@supabase/ssr` stores **this project's** session under.
 *
 * supabase-js derives its storage key as
 * ``sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`` — so
 * `https://abcdefgh.supabase.co` gives `sb-abcdefgh-auth-token`, and the local
 * stack on `http://127.0.0.1:54321` gives `sb-127-auth-token`. That rule is
 * reproduced here rather than imported because, like the cookie format itself,
 * it is not exported.
 *
 * **Anchoring to our own ref is a security property, not tidiness.** An earlier
 * revision matched any `sb-<anything>-auth-token`, which is exploitable on a
 * shared parent domain: script on a sibling host sets a `Domain=.example.com`
 * cookie named for a project ref of its choosing, carrying an unsigned token
 * with a `sub` and `active_chapter_id` it also controls, plus a matching accent
 * row — and because an unchunked cookie is preferred over the victim's real,
 * chunked one, the victim's dashboard first-paints in attacker-chosen colours.
 * The token is never signature-verified here (`active-chapter-claim.ts` says
 * why that is fine), so the cookie *name* is what decides whose session this
 * is. It now has to be ours.
 *
 * The benign half of the same bug: a second Supabase-backed app on `localhost`
 * — cookies ignore the port — left an `sb-<otherref>-auth-token` in the jar,
 * whose `sub` belongs to another project, and the accent silently stopped
 * painting with nothing to see.
 *
 * Returns `null` when the env var is missing or unparseable, which fails closed
 * to one ordinary cold load.
 */
export function supabaseAuthCookieName(
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string | null {
  if (!supabaseUrl) return null;
  try {
    const first = new URL(supabaseUrl).hostname.split(".")[0];
    return first ? `sb-${first}-auth-token` : null;
  } catch {
    return null;
  }
}

/**
 * That exact name, optionally with a `.<n>` chunk suffix.
 *
 * The PKCE code-verifier keys Supabase stores alongside the session
 * (`…-code-verifier`, `…-flows-code-verifier`, `…-flow-<id>-code-verifier`) all
 * extend the name rather than suffixing `.<n>`, so this cannot match one.
 */
function chunkIndexOf(cookieName: string, base: string): number | null {
  if (cookieName === base) return -1;
  if (!cookieName.startsWith(`${base}.`)) return null;
  const suffix = cookieName.slice(base.length + 1);
  return /^\d+$/.test(suffix) ? Number(suffix) : null;
}

export interface RequestCookie {
  name: string;
  value: string;
}

/**
 * The access token from a cookie jar, or `null`.
 *
 * `null` for every failure: no auth cookie, no derivable project ref, chunks
 * that do not reassemble, a value that is not JSON, JSON with no
 * `access_token`. See the header for why that is the only sensible failure mode
 * here.
 *
 * `cookieName` defaults to this project's, derived from the env. The parameter
 * exists so a test can name it without reaching into `process.env`.
 */
export function readAccessTokenFromCookies(
  cookies: readonly RequestCookie[],
  cookieName: string | null = supabaseAuthCookieName(),
): string | null {
  if (!cookieName) return null;
  const chunks: Array<{ index: number; value: string }> = [];
  for (const cookie of cookies) {
    const index = chunkIndexOf(cookie.name, cookieName);
    if (index === null) continue;
    /*
      An unchunked cookie is recorded as index -1 so both shapes take one code
      path. A jar holding both (a session that shrank below the chunk threshold
      and left `.0` behind, say) would concatenate them — hence `session`, which
      takes the unchunked value alone when one is present.
    */
    chunks.push({ index, value: cookie.value });
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
  try {
    return base64UrlDecode(value.slice(BASE64_PREFIX.length));
  } catch {
    return null;
  }
}
