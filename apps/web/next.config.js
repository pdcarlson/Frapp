import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@repo/theme", "@repo/ui"],
};

/**
 * Sentry build-time wiring (issue #865).
 *
 * `withSentryConfig` injects `instrumentation-client.ts` into the client bundle
 * and, when credentials exist, uploads source maps so a minified stack trace is
 * readable. Everything here is chosen so the build behaves identically with and
 * without Sentry credentials — `npm run build -w apps/web` must pass on a
 * developer laptop and in CI, neither of which has an auth token.
 *
 * - **`sourcemaps.disable` keys off `SENTRY_AUTH_TOKEN`.** Upload is the only
 *   part that needs a credential; with no token the plugin would otherwise warn
 *   on every build and do nothing useful. The release-time upload is a
 *   deploy-environment concern, not a build-correctness one.
 * - **`telemetry: false`** — the build must not phone home from CI.
 * - **`silent` off in CI** so an upload failure is visible in the log rather
 *   than swallowed, and on locally so builds stay quiet.
 *
 * `disableLogger` is deliberately absent: the SDK deprecates it in favour of
 * `webpack.treeshake.removeDebugLogging`, and that replacement is not supported
 * under Turbopack, which is what Next 16 builds with here. Setting it only
 * bought a deprecation warning on every typecheck.
 *
 * Note this wrapper applies regardless of whether a DSN is configured: it is
 * build-time plumbing. The *runtime* no-op when `NEXT_PUBLIC_SENTRY_DSN` is
 * unset is enforced separately, in `instrumentation.ts` and
 * `instrumentation-client.ts`, which skip `Sentry.init` entirely.
 */
export default withSentryConfig(nextConfig, {
  org: "frapp-live",
  project: "frapp-web",
  telemetry: false,
  silent: !process.env.CI,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
