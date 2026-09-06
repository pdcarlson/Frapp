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

export interface AuthUrls {
  signupUrl: string;
  loginUrl: string;
}

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
