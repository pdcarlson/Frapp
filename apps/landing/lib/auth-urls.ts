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
 *   the production app origin. A trailing slash, or a trailing `/sign-up`
 *   accidentally baked into the env value, is stripped before paths are joined.
 */
export function buildAuthUrls(rawAppBaseUrl?: string | null): AuthUrls {
  const base = (rawAppBaseUrl ?? DEFAULT_APP_BASE_URL).replace(/\/$/, "");
  const appBaseUrl = base.endsWith(SIGN_UP_PATH)
    ? base.slice(0, -SIGN_UP_PATH.length)
    : base;

  return {
    signupUrl: new URL(SIGN_UP_PATH, `${appBaseUrl}/`).toString(),
    loginUrl: new URL(SIGN_IN_PATH, `${appBaseUrl}/`).toString(),
  };
}
