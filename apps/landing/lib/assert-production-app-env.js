/**
 * Vercel production (`VERCEL_ENV=production`) inlines `NEXT_PUBLIC_APP_URL`
 * into landing CTAs and the `/join` redirect. A staging origin would 500
 * every request (`assertProductionAppOrigin` at render). Unset still falls
 * back to the production app origin at request time.
 *
 * Preview (`DEPLOY_TARGET: preview`) and CI `web-production-build` leave
 * `VERCEL_ENV` unset and skip this. Do not import `@repo/validation` from
 * `next.config.js` — that package's `"import"` is TypeScript source.
 * The string below is the same value the package exports; the spec pins them.
 */

export const PRODUCTION_APP_ORIGIN = "https://app.frapp.live";

/**
 * @param {{
 *   vercelEnv?: string | null,
 *   appUrl?: string | null,
 * }} [input]
 */
export function assertProductionLandingAppEnv(input = {}) {
  if (input.vercelEnv !== "production") return;
  if (input.appUrl == null) return;
  if (typeof input.appUrl !== "string" || input.appUrl.trim() === "") {
    throw new Error(
      `NEXT_PUBLIC_APP_URL must be ${PRODUCTION_APP_ORIGIN} in production (got empty).`,
    );
  }
  let url;
  try {
    url = new URL(input.appUrl.trim());
  } catch {
    throw new Error(
      `NEXT_PUBLIC_APP_URL must be ${PRODUCTION_APP_ORIGIN} in production (got unparseable).`,
    );
  }
  url.username = "";
  url.password = "";
  if (url.origin !== PRODUCTION_APP_ORIGIN) {
    throw new Error(
      `NEXT_PUBLIC_APP_URL must be ${PRODUCTION_APP_ORIGIN} in production (got ${url.protocol}//${url.host}).`,
    );
  }
}
