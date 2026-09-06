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
 *   Both auth paths are absolute, so `new URL` keeps the base's origin and its
 *   userinfo and discards its path, query and fragment. Keep the paths
 *   absolute: made relative, they would resolve against the base's path
 *   instead, which `auth-urls.spec.ts`'s multi-segment case is there to catch.
 */
export function buildAuthUrls(rawAppBaseUrl?: string | null): AuthUrls {
  const appBaseUrl = rawAppBaseUrl ?? DEFAULT_APP_BASE_URL;

  return {
    signupUrl: new URL(SIGN_UP_PATH, appBaseUrl).toString(),
    loginUrl: new URL(SIGN_IN_PATH, appBaseUrl).toString(),
  };
}
