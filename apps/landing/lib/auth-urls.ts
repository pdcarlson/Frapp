import {
  assertHttpsJoinOrigin,
  assertProductionAppOrigin,
  PRODUCTION_APP_ORIGIN,
} from "@repo/validation";

/**
 * Builds the landing site's auth call-to-action URLs.
 *
 * The marketing site links to the web app's Supabase Auth screens. The web app
 * (`apps/web`) exposes `/sign-in` and `/sign-up` — there is no `/login` or
 * `/signup` route and no redirect bridging them, so the targets must match the
 * real routes exactly (see `spec/product/surfaces.md`). This helper is unit
 * tested so the CTA paths cannot silently drift again.
 */

const DEFAULT_APP_BASE_URL = PRODUCTION_APP_ORIGIN;

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

export interface LandingRuntimeEnv {
  /** `VERCEL_ENV`. Staging deploys this repo as `preview` (`DEPLOY_TARGET: preview`). */
  vercelEnv?: string | null;
}

function vercelEnvOf(runtime: LandingRuntimeEnv): string | undefined {
  return runtime.vercelEnv !== undefined
    ? (runtime.vercelEnv ?? undefined)
    : process.env.VERCEL_ENV;
}

function isParseableAbsoluteHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}

/**
 * `??` only treats `null`/`undefined` as missing. Infisical and Vercel both
 * accept an empty string for a defined key, and a scheme-less host is a
 * common paste. Those used to reach `new URL` and 500 `/` (#1777).
 *
 * A parseable `http(s)` origin is returned as-is — including staging and
 * loopback — so this is a parse floor, not an origin fence. Production
 * origin checks run on the resolved value.
 */
function resolveAppBaseUrl(rawAppBaseUrl?: string | null): string {
  if (typeof rawAppBaseUrl !== "string") {
    return DEFAULT_APP_BASE_URL;
  }
  const trimmed = rawAppBaseUrl.trim();
  if (!isParseableAbsoluteHttpUrl(trimmed)) {
    return DEFAULT_APP_BASE_URL;
  }
  return trimmed;
}

function assertProductionLandingAppOrigin(
  appBaseUrl: string,
  runtime: LandingRuntimeEnv,
): void {
  if (vercelEnvOf(runtime) !== "production") return;
  try {
    assertProductionAppOrigin(appBaseUrl, "NEXT_PUBLIC_APP_URL");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      detail.startsWith("NEXT_PUBLIC_APP_URL")
        ? detail
        : `NEXT_PUBLIC_APP_URL: ${detail}`,
    );
  }
}

/**
 * @param rawAppBaseUrl typically `process.env.NEXT_PUBLIC_APP_URL`. Defaults to
 *   the production app origin when the value is null, undefined, blank,
 *   whitespace, or not a parseable absolute `http(s)` URL (#1777).
 *
 *   Both auth paths are absolute, so `new URL` keeps the base's origin and
 *   discards its path, query and fragment. Keep the paths absolute: made
 *   relative, they would resolve against the base's path instead, which
 *   `auth-urls.spec.ts`'s multi-segment case is there to catch.
 */
export function buildAuthUrls(
  rawAppBaseUrl?: string | null,
  runtime: LandingRuntimeEnv = {},
): AuthUrls {
  const appBaseUrl = resolveAppBaseUrl(rawAppBaseUrl);
  assertProductionLandingAppOrigin(appBaseUrl, runtime);

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
  runtime: LandingRuntimeEnv = {},
): string {
  const appBaseUrl = resolveAppBaseUrl(rawAppBaseUrl);
  const url = new URL(authUrl(JOIN_PATH, appBaseUrl));
  // Refuse before copying the invite query: an http: Location would put the
  // token on the wire in the clear. Loopback http is local Infisical APP_URL.
  try {
    assertHttpsJoinOrigin(url);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`NEXT_PUBLIC_APP_URL: ${detail}`);
  }
  assertProductionLandingAppOrigin(appBaseUrl, runtime);
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
 * 500 the homepage from a server component, and falling back to the default
 * would silently send staging visitors to production. The cost is that a
 * basic-auth-gated base now yields CTAs that 401 instead of authenticating,
 * with nothing logged. No such base is configured (`DEPLOYMENT.md` § 4.2).
 * Blank / scheme-less bases are a different case — they never parse, so they
 * fall back in `resolveAppBaseUrl` before this helper runs (#1777).
 */
function authUrl(path: string, base: string): string {
  const url = new URL(path, base);
  url.username = "";
  url.password = "";
  return url.toString();
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
