/**
 * Sentry webpack-plugin options for `apps/landing`.
 *
 * Source maps and debug IDs stay enabled even when `SENTRY_AUTH_TOKEN` is
 * unset so a production-parity `next build` still injects debug IDs. Upload
 * is skipped without a token; `silent` is on in that case so CI and laptops
 * do not warn. Do not set `sourcemaps.disable: true` or `debugIds: false`.
 *
 * The Sentry project is `frapp-landing`, not `frapp-web`. Org settings
 * disable member project creation (#970); until that project exists, upload
 * 404s. `errorHandler` swallows that so the Vercel build still succeeds —
 * debug IDs remain in the bundle. This file does not prove live symbolication.
 */

/**
 * @param {{ authToken?: string }} [env]
 */
export function getSentryBuildConfig({
  authToken = process.env.SENTRY_AUTH_TOKEN,
} = {}) {
  const hasAuthToken = Boolean(authToken);
  return {
    org: "frapp-live",
    project: "frapp-landing",
    telemetry: false,
    silent: !hasAuthToken,
    widenClientFileUpload: true,
    sourcemaps: {
      disable: false,
    },
    /**
     * A blast-radius `SENTRY_AUTH_TOKEN` (Infisical path `/`) plus a missing
     * `frapp-landing` project must not fail `next build`. Debug IDs still
     * inject because `sourcemaps.disable` is false.
     */
    errorHandler(err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        "[landing sentry] source map upload skipped; debug IDs remain in the bundle:",
        message,
      );
    },
  };
}
