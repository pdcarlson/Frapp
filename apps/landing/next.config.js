import { withSentryConfig } from "@sentry/nextjs";
import { getAnonymousSentryBuildConfig } from "@repo/observability/next/sentry-build-config.js";
import { assertProductionLandingAppEnv } from "./lib/assert-production-app-env.js";

// Vercel Production (`VERCEL_ENV=production`) inlines NEXT_PUBLIC_APP_URL
// into CTAs and the /join redirect. A staging origin 500s every request
// (assertProductionAppOrigin at render). Unset still falls back at request
// time; blank/staging/localhost fail the build. Do not import
// @repo/validation from this file — its "import" condition is TypeScript.
assertProductionLandingAppEnv({
  vercelEnv: process.env.VERCEL_ENV,
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
});

/**
 * Git SHA used as Sentry `release` (runtime init AND source-map upload).
 * ADR-21 `vercel build` injects `VERCEL_GIT_COMMIT_SHA` from `DEPLOY_SHA`.
 */
const sentryGitSha = process.env.VERCEL_GIT_COMMIT_SHA || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@repo/theme", "@repo/validation", "@repo/observability"],
  experimental: {
    // Next 16 defaults this to true and then looks for `typescript/bin/tsc`.
    // The `typescript` package here is `@typescript/typescript6` (compiler API
    // + `tsc6` only) so Nest, typescript-eslint, and ts-jest keep working;
    // native `tsc` lives on `@typescript/native`. API mode uses that compiler
    // API. See docs/internal/ci-cd/AGENT_INFRA.md § TypeScript 7.
    useTypeScriptCli: false,
  },
  // Type-check the build against `tsconfig.build.json`, not `tsconfig.json`.
  //
  // Vercel's production install omits devDependencies. `tsconfig.json` includes
  // every .ts and .tsx file under the app, so `vitest.config.ts` and
  // `lib/auth-urls.spec.ts` both land in the TS program `next build` type-checks,
  // and both import `vitest`, which is not on disk there.
  //
  // It is not the suffixed test files that break the build: Next discards
  // diagnostics from files *named* `*.test.*`, `*.spec.*`, `__tests__/` or
  // `__mocks__/` (next/dist/lib/typescript/runTypeCheck.js). What surfaces is the
  // in-program files carrying no test suffix — here `vitest.config.ts` alone.
  // `lib/auth-urls.spec.ts` is suppressed by its name, so despite importing
  // `vitest` it could never have failed a build; every frapp-landing deploy with
  // `target: production` died on the config file.
  //
  // Preview builds do not show any of this, because they do not run the same
  // install. The failing production build did a cold `npm install --prefix=../..`
  // and logged `added 1126 packages, and audited 1144`; the `main` preview of the
  // same tree restored a build cache and logged `up to date, audited 1958
  // packages`. So a green preview is not evidence about this failure — and
  // neither is a green local build, since `node_modules/vitest` exists in a dev
  // checkout. Reproduce it with `npm install --omit=dev` at the root.
  //
  // This is the same failure #1331 fixed for `@repo/hooks`, one layer up. Its
  // suffix-only exclude does not transfer, because the files that actually reach
  // Next's error report have no test suffix. `tsconfig.json` still includes
  // everything excluded here, so `check-types` and the editor keep typechecking
  // it — the coverage is not traded away for the fix.
  //
  // Two things to know before editing: Next reads `tsconfigPath` for path-alias
  // resolution as well as for the type check (`build/load-jsconfig.ts`,
  // `build/type-check.ts`), so the build config must EXTEND the app config rather
  // than replace it; and `exclude` overrides rather than merges, so an exclusion
  // added to `tsconfig.json` does not reach this build.
  typescript: {
    tsconfigPath: "tsconfig.build.json",
  },
  env: {
    /**
     * Sentry environment tag, **derived** from Vercel's `VERCEL_ENV` rather
     * than configured. Do not add `NEXT_PUBLIC_SENTRY_ENVIRONMENT` to Infisical.
     */
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.VERCEL_ENV ?? "development",
    /**
     * Sentry `release`, **derived** from `VERCEL_GIT_COMMIT_SHA`. Empty
     * locally and in non-deploy CI. Staging/production `vercel build`
     * injects that variable from `DEPLOY_SHA` (ADR-21 runner path).
     * Do not add `NEXT_PUBLIC_SENTRY_RELEASE` to Infisical.
     */
    NEXT_PUBLIC_SENTRY_RELEASE: sentryGitSha || "",
  },
};

/**
 * Sentry build-time wiring (issue #2041).
 *
 * Runtime ingest uses `NEXT_PUBLIC_LANDING_SENTRY_DSN` (`frapp-landing`), never
 * `NEXT_PUBLIC_SENTRY_DSN` (that is `frapp-web`; Infisical path `/` dumps both).
 * `withSentryConfig` injects debug IDs even without `SENTRY_AUTH_TOKEN`.
 * Upload is skipped without a token. Live symbolication is not claimed here.
 *
 * The wrapper applies regardless of whether a DSN is configured. The runtime
 * no-op is in `instrumentation.ts` / `instrumentation-client.ts`.
 */
export default withSentryConfig(
  nextConfig,
  getAnonymousSentryBuildConfig({
    project: "frapp-landing",
    authToken: process.env.SENTRY_AUTH_TOKEN,
    release: sentryGitSha,
    errorHandler(err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        "[landing sentry] source map upload skipped; debug IDs remain in the bundle:",
        message,
      );
    },
  }),
);
