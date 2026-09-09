/**
 * Sentry webpack-plugin options for `apps/web`.
 *
 * Source maps and debug IDs stay enabled even when `SENTRY_AUTH_TOKEN` is
 * unset so a production-parity `next build` still injects debug IDs. Upload
 * is skipped without a token; `silent` is on in that case so CI and laptops
 * do not warn. Do not set `sourcemaps.disable: true` or `debugIds: false`.
 *
 * Live symbolication on staging still needs the auth token (#970) — this file
 * only proves the build is configured to inject debug IDs.
 */

/**
 * @param {{ authToken?: string, ci?: string }} [env]
 */
export function getSentryBuildConfig({
  authToken = process.env.SENTRY_AUTH_TOKEN,
} = {}) {
  const hasAuthToken = Boolean(authToken);
  return {
    org: "frapp-live",
    project: "frapp-web",
    telemetry: false,
    silent: !hasAuthToken,
    widenClientFileUpload: true,
    sourcemaps: {
      disable: false,
    },
  };
}
