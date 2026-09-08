/**
 * Builds the landing site's auth call-to-action URLs.
 *
 * The marketing site links to the web app's Supabase Auth screens. The web app
 * (`apps/web`) exposes `/sign-in` and `/sign-up` — there is no `/login` or
 * `/signup` route and no redirect bridging them, so the targets must match the
 * real routes exactly (see `spec/product/surfaces.md`). This helper is unit
 * tested so the CTA paths cannot silently drift again.
 */

const DEFAULT_APP_BASE_URL = "https://app.frapp.live";

const SIGN_UP_PATH = "/sign-up";
const SIGN_IN_PATH = "/sign-in";
const JOIN_PATH = "/join";

export interface AuthUrls {
  signupUrl: string;
  loginUrl: string;
}

type JoinSearch =
  | string
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | null
  | undefined;

/**
 * @param rawAppBaseUrl typically `process.env.NEXT_PUBLIC_APP_URL`. Defaults to
 *   the production app origin when null or undefined — but *only* then: a value
 *   that is set-but-blank, or has no scheme, still reaches `new URL` and throws
 *   (#1777).
 *
 *   Both auth paths are absolute, so `new URL` keeps the base's origin and
 *   discards its path, query and fragment. Keep the paths absolute: made
 *   relative, they would resolve against the base's path instead, which
 *   `auth-urls.spec.ts`'s multi-segment case is there to catch.
 */
export function buildAuthUrls(rawAppBaseUrl?: string | null): AuthUrls {
  const appBaseUrl = rawAppBaseUrl ?? DEFAULT_APP_BASE_URL;

  return {
    signupUrl: authUrl(SIGN_UP_PATH, appBaseUrl),
    loginUrl: authUrl(SIGN_IN_PATH, appBaseUrl),
  };
}

/**
 * Marketing `/join` is not a landing page. Officers mint
 * `app.frapp.live/join?token=…`; people still type or paste the apex host.
 * Forward to the web app origin with the query intact so a still-valid
 * token does not 404 on `frapp.live`.
 */
export function buildJoinUrl(
  rawAppBaseUrl?: string | null,
  search?: JoinSearch,
): string {
  const url = new URL(authUrl(JOIN_PATH, rawAppBaseUrl ?? DEFAULT_APP_BASE_URL));
  // Refuse before copying the invite query: an http: Location would put the
  // token on the wire in the clear. Loopback http is local Infisical APP_URL.
  assertHttpsJoinBase(url);
  applyJoinSearch(url, search);
  return url.toString();
}

/**
 * Joins an absolute auth path onto `base`, dropping any userinfo the base
 * carries. `new URL` preserves userinfo, so a credentialed base would put
 * `https://user:pass@…` into a CTA `href` that is server-rendered into public
 * HTML.
 *
 * That href is the only way the value reaches a browser: `apps/landing` has no
 * client components, so Next never inlines `NEXT_PUBLIC_APP_URL` into a client
 * bundle. So a credential ever configured here was exposed in served HTML and
 * needs rotating — the `NEXT_PUBLIC_` prefix means "safe to expose", not
 * "was not exposed".
 *
 * Stripping is chosen over the two alternatives, neither free: throwing would
 * 500 the homepage from a server component (#1777), and falling back to the
 * default would silently send staging visitors to production. The cost is that
 * a basic-auth-gated base now yields CTAs that 401 instead of authenticating,
 * with nothing logged. No such base is configured (`DEPLOYMENT.md` § 4.2).
 */
function authUrl(path: string, base: string): string {
  const url = new URL(path, base);
  url.username = "";
  url.password = "";
  return url.toString();
}

/**
 * Invite tokens travel in this redirect's query. A public `http:` base would
 * put them on the wire in the clear. Loopback `http:` is the local Infisical
 * `APP_URL` (`http://localhost:3000`) and never leaves the machine.
 *
 * Throwing 500s `/join` from the server component rather than forwarding. That
 * is the opposite of `authUrl`'s userinfo strip, which cannot 500 the
 * homepage; here fail-closed beats a cleartext token.
 */
function assertHttpsJoinBase(url: URL): void {
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) return;
  throw new Error(
    `NEXT_PUBLIC_APP_URL must use https: before a /join redirect (got ${url.protocol}//${url.host}). ` +
      `An http: base would put the invite token on the wire in the clear.`,
  );
}

function isLoopbackHostname(hostname: string): boolean {
  // Node's URL.hostname for IPv6 includes the brackets (`[::1]`). Strip
  // them so `http://[::1]:3000` matches the same as `::1`.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function applyJoinSearch(url: URL, search: JoinSearch): void {
  if (search == null || search === "") return;
  if (typeof search === "string") {
    url.search = search.startsWith("?") ? search.slice(1) : search;
    return;
  }
  if (search instanceof URLSearchParams) {
    url.search = search.toString();
    return;
  }
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item === "") continue;
      url.searchParams.append(key, item);
    }
  }
}
