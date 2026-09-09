import { withSentryConfig } from "@sentry/nextjs";
import { assertProductionWebPublicEnv } from "./lib/assert-production-public-env.js";
import { getSentryBuildConfig } from "./lib/sentry/build-config.js";

// Vercel Production (`VERCEL_ENV=production`) inlines NEXT_PUBLIC_* into the
// dashboard. Unset/staging/localhost would ship FrappProvider's
// http://localhost:3001 fallback or the staging API/DB. Preview and CI
// `web-production-build` leave VERCEL_ENV unset (CI uses localhost stand-ins
// on purpose) so this is a no-op there. Do not import @repo/validation from
// this file — its "import" condition is TypeScript source.
assertProductionWebPublicEnv({
  vercelEnv: process.env.VERCEL_ENV,
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@repo/theme", "@repo/formatting", "@repo/observability"],
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
  // every .ts and .tsx file under the app, so the 76 test files, their helpers
  // under `tests/`, and the vitest/playwright configs all land in the TS program
  // `next build` type-checks, and they import packages that are not on disk there.
  //
  // It is not the suffixed test files that break the build: Next discards
  // diagnostics from files *named* `*.test.*`, `*.spec.*`, `__tests__/` or
  // `__mocks__/` (next/dist/lib/typescript/runTypeCheck.js). What surfaces is the
  // in-program files carrying no test suffix: `tests/chapter-subscription.ts`, a
  // plain mock helper, and `vitest.config.ts`. Next reports only the first by path
  // order, which is why every deploy log names the same file:
  //
  //   ./tests/chapter-subscription.ts:1:27
  //   Type error: Cannot find module 'vitest' or its corresponding type declarations.
  //
  // `tests/setup.ts` and `playwright.config.ts` sit in the same position and are
  // latent rather than failing only because a non-dev copy of what they import
  // happens to survive the prune: `@playwright/test` is an optional peerDependency
  // of `next`, and the surviving `@testing-library/jest-dom` is a *different* major
  // hoisted to the root by `expo-router`, not this app's v7. Neither is a guarantee,
  // so the exclude covers them too.
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
     * The Sentry environment tag, **derived** rather than configured.
     *
     * Vercel already knows which environment a deployment is: `VERCEL_ENV` is a
     * system variable it sets at build time to `production` / `preview` /
     * `development`. Requiring a hand-set `NEXT_PUBLIC_SENTRY_ENVIRONMENT` in
     * Infisical would be a second copy of that fact, maintained by hand, in two
     * environments — and its failure mode is silent: set it to `production` in
     * the Staging environment by mistake and every staging error is tagged
     * production forever, with nothing to catch it.
     *
     * `NODE_ENV` is not usable here for the opposite reason: Vercel Preview and
     * Production are *both* `production` to Next, so it cannot tell them apart.
     *
     * Values listed under `env` are inlined into the bundle at build time
     * regardless of prefix (Next `env` config), so this reaches the browser
     * without an entry in any secret store. **Do not add
     * `NEXT_PUBLIC_SENTRY_ENVIRONMENT` to Infisical** — this replacement happens
     * at build time and would win over it silently.
     */
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.VERCEL_ENV ?? "development",
    /**
     * Sentry `release`, **derived** from Vercel's git SHA rather than configured.
     * Empty locally/CI when `VERCEL_GIT_COMMIT_SHA` is unset. **Do not add
     * `NEXT_PUBLIC_SENTRY_RELEASE` to Infisical** — this replacement would win
     * over it silently, same as `NEXT_PUBLIC_SENTRY_ENVIRONMENT`.
     */
    NEXT_PUBLIC_SENTRY_RELEASE:
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.NEXT_PUBLIC_SENTRY_RELEASE ||
      "",
  },
};

/**
 * Sentry build-time wiring (issue #865).
 *
 * `withSentryConfig` injects `instrumentation-client.ts` into the client bundle
 * and injects debug IDs / source maps so a minified stack trace is readable.
 * Upload still needs `SENTRY_AUTH_TOKEN`; without it the plugin stays silent
 * and skips upload. Source maps themselves are **not** disabled — that used
 * to also skip debug-ID injection, so a CI build with no token produced a
 * bundle Sentry could not symbolicate even after a later token was added.
 *
 * - **`sourcemaps.disable` is always false.** Debug IDs stay in the bundle.
 * - **`telemetry: false`** — the build must not phone home from CI.
 * - **`silent` when there is no auth token** so laptops and CI without a token
 *   stay quiet. With a token, failures are visible.
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
export default withSentryConfig(nextConfig, getSentryBuildConfig());
