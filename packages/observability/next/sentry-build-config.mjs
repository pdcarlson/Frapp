/**
 * Sentry webpack-plugin options shared by Next.js apps.
 *
 * Source maps and debug IDs stay enabled even when `SENTRY_AUTH_TOKEN` is
 * unset so a production-parity `next build` still injects debug IDs. Upload
 * is skipped without a token; `silent` is on in that case so CI and laptops
 * do not warn. Do not set `sourcemaps.disable: true` or `debugIds: false`.
 *
 * `next.config.js` loads this file through the package export
 * `@repo/observability/next/sentry-build-config.js` (this `.mjs` file).
 * Callers pass `authToken` — this helper does not read `process.env` so a
 * client graph cannot pick it up.
 *
 * ESM (`.mjs`) because `@repo/observability` has no `"type": "module"` and
 * Next's `next.config.js` is ESM.
 *
 * @param {{ org?: string, project: string, authToken?: string, errorHandler?: Function }} opts
 */
export function getAnonymousSentryBuildConfig({
  org = "frapp-live",
  project,
  authToken,
  errorHandler,
} = {}) {
  if (typeof project !== "string" || project.length === 0) {
    throw new Error("getAnonymousSentryBuildConfig requires project");
  }
  const hasAuthToken = Boolean(authToken);
  return {
    org,
    project,
    telemetry: false,
    silent: !hasAuthToken,
    widenClientFileUpload: true,
    sourcemaps: {
      disable: false,
    },
    ...(typeof errorHandler === "function" ? { errorHandler } : {}),
  };
}
