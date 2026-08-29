/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@repo/theme"],
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
  // `lib/auth-urls.test.ts` both land in the TS program `next build` type-checks,
  // and both import `vitest`, which is not on disk there.
  //
  // It is not the suffixed test files that break the build: Next discards
  // diagnostics from files *named* `*.test.*`, `*.spec.*`, `__tests__/` or
  // `__mocks__/` (next/dist/lib/typescript/runTypeCheck.js). What surfaces is the
  // in-program files carrying no test suffix — here `vitest.config.ts` alone.
  // `lib/auth-urls.test.ts` is suppressed by its name, so despite importing
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
};

export default nextConfig;
