import { withSentryConfig } from "@sentry/nextjs";
import { assertProductionLandingAppEnv } from "./lib/assert-production-app-env.js";
import { getSentryBuildConfig } from "./lib/sentry/build-config.js";

// Vercel Production (`VERCEL_ENV=production`) inlines NEXT_PUBLIC_APP_URL
// into CTAs and the /join redirect. A staging origin 500s every request
// (assertProductionAppOrigin at render). Unset still falls back at request
// time; blank/staging/localhost fail the build. Do not import
// @repo/validation from this file — its "import" condition is TypeScript.
assertProductionLandingAppEnv({
  vercelEnv: process.env.VERCEL_ENV,
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@repo/theme", "@repo/validation", "@repo/observability"],
  // Next 16 + dual TypeScript packages: keep `useTypeScriptCli` off. Why, and
  // why `tsconfig.build.json` is the production typecheck: AGENT_INFRA.md
  // TypeScript 7 and `apps/web/next.config.js`. Landing's omit-dev failure
  // was `vitest.config.ts` (no test suffix, so Next reports it).
  experimental: { useTypeScriptCli: false },
  typescript: { tsconfigPath: "tsconfig.build.json" },
  env: {
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.VERCEL_ENV ?? "development",
    NEXT_PUBLIC_SENTRY_RELEASE:
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.NEXT_PUBLIC_SENTRY_RELEASE ||
      "",
  },
};

// Build-time debug IDs (#2041). Runtime ingest is LANDING_SENTRY_DSN only —
// never the web DSN. Upload still needs SENTRY_AUTH_TOKEN; without it this
// stays silent. Init no-op lives in instrumentation*.ts.
export default withSentryConfig(nextConfig, getSentryBuildConfig());
