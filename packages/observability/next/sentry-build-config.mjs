/**
 * `withSentryConfig` build options shared by Next.js apps (SDK v11 builds
 * through `@sentry/bundler-plugins`; the webpack plugin is gone).
 *
 * Source maps and debug IDs stay enabled even when `SENTRY_AUTH_TOKEN` is
 * unset so a production-parity `next build` still injects debug IDs. Upload
 * is skipped without a token; `silent` is on in that case so CI and laptops
 * do not warn. Do not set `sourcemaps.disable: true` or `debugIds: false`.
 *
 * `next.config.js` loads this file through the package export
 * `@repo/observability/next/sentry-build-config.js` (this `.mjs` file).
 * Callers pass `authToken` and `release` — this helper does not read
 * `process.env` so a client graph cannot pick either up. The token is
 * forwarded onto the plugin options (not only used to flip `silent`) so
 * upload does not depend on a later env fallback. `release.name` is the
 * same git SHA `next.config.js` inlines as `NEXT_PUBLIC_SENTRY_RELEASE`, so
 * a map upload and a runtime event agree even when git auto-detect is
 * unavailable (ADR-21 `vercel build` on the runner).
 *
 * ESM (`.mjs`) because `@repo/observability` has no `"type": "module"` and
 * Next's `next.config.js` is ESM.
 *
 * @param {{ org?: string, project: string, authToken?: string, release?: string, errorHandler?: Function }} opts
 */
const GIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

/**
 * The Sentry `environment` tag for a Vercel build, from Vercel's `VERCEL_ENV`.
 *
 * Staging is a Vercel **preview** build: this repo deploys only `production`
 * and `preview` (`scripts/ci/lib/vercel-cli.mjs`, `VERCEL_TARGET_PREVIEW`),
 * and the preview build is what staging serves. Passing `VERCEL_ENV` through
 * tagged every staging event `preview` while the API and mobile tag the same
 * environment `staging`, so one environment read as two in Sentry (#2505).
 * Unset (a laptop, a non-deploy CI build) is `development`, never
 * `production`, which is what Sentry assumes when no environment is given.
 * Any other value passes through, so a new Vercel environment shows up under
 * its own name instead of hiding inside one of these.
 *
 * The caller passes `VERCEL_ENV` in; like the helper below, this reads no
 * `process.env` itself.
 *
 * @param {string | undefined} vercelEnv
 * @returns {string}
 */
export function sentryEnvironmentForVercelEnv(vercelEnv) {
  if (!vercelEnv) return "development";
  if (vercelEnv === "preview") return "staging";
  return vercelEnv;
}

export function getAnonymousSentryBuildConfig({
  org = "frapp-live",
  project,
  authToken,
  release,
  errorHandler,
} = {}) {
  if (typeof project !== "string" || project.length === 0) {
    throw new Error("getAnonymousSentryBuildConfig requires project");
  }
  const hasAuthToken = Boolean(authToken);
  const releaseName =
    typeof release === "string" && GIT_SHA_PATTERN.test(release.trim())
      ? release.trim()
      : undefined;
  return {
    org,
    project,
    telemetry: false,
    silent: !hasAuthToken,
    widenClientFileUpload: true,
    sourcemaps: {
      disable: false,
    },
    ...(hasAuthToken ? { authToken } : {}),
    ...(releaseName ? { release: { name: releaseName } } : {}),
    ...(typeof errorHandler === "function" ? { errorHandler } : {}),
  };
}
