import { defineConfig } from "@playwright/test";

const isCi = Boolean(process.env.CI);

/**
 * Benign defaults for the Playwright `webServer` invocation.
 *
 * The floor suite boots `npm run dev` inside CI, which does not have Supabase
 * credentials available. These placeholders let Next.js finish its boot
 * handshake (the shape is a valid HTTP URL and a well-formed JWT-ish string) so
 * pages render and can be measured. `SUPABASE_AUTH_BYPASS` tells the proxy
 * (`apps/web/proxy.ts`) to skip auth redirects entirely, so protected routes
 * render their actual content instead of redirecting to `/sign-in`. Real
 * deployments always provide the production values via Vercel + Infisical and
 * never set the bypass flag.
 */
const webServerEnvDefaults: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiJ9.playwright-stand-in.signature",
  NEXT_PUBLIC_API_URL: "http://127.0.0.1:3001",
  SUPABASE_AUTH_BYPASS: "true",
};

function resolvedWebServerEnv(): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      merged[key] = value;
    }
  }
  for (const [key, fallback] of Object.entries(webServerEnvDefaults)) {
    if (!merged[key]) {
      merged[key] = fallback;
    }
  }
  return merged;
}

export default defineConfig({
  testDir: "./tests/visual",
  timeout: 30_000,
  fullyParallel: false,
  workers: isCi ? 1 : undefined,
  /**
   * A committed `test.only` narrows the run to that one test and still exits 0.
   * `web-responsive-floor` is a required check, so the gate would report success
   * having measured a single dashboard route — the same silent-coverage loss it
   * exists to catch.
   *
   * The other hollow-gate route is running zero tests and exiting 0. Playwright
   * still guards that: when a run collects **no tests at all** it prints "No
   * tests found" and exits **1**. Verified by running it, not assumed — against
   * 1.62.1, which is what `npm ci` resolves today; `package.json` asks for
   * `^1.62.1`, so re-check this on any upgrade that moves the lockfile.
   *
   * Note what that guard covers, because directory selection narrowed it. Under
   * `--grep @floor` it fired whenever no test carried the tag — that is,
   * whenever *the floor suite specifically* went missing. Selecting by directory
   * it fires on the collected-test count instead, so it still catches deleting
   * this spec today (nothing else here matches `testMatch`; `routes.ts` and
   * `README.md` do not). What it stops catching is the two-spec case: add a
   * second spec, then delete or rename the floor spec, and the run passes on the
   * survivor and exits 0 with the floor silently unmeasured. Adding a second
   * spec to this directory means taking that on deliberately.
   */
  forbidOnly: isCi,
  /**
   * Insurance, not a fix for a measured problem — stated that way because the
   * obvious reading of #1152 is wrong and worth writing down.
   *
   * Splitting the floor suite into its own job meant it no longer inherited
   * warm route compiles from the snapshot suite that used to run before it in
   * the same worker, so it pays every route's first Turbopack compile itself.
   * That sounds like it should matter for a required check and does not: the
   * expensive part of a cold `next dev` — boot plus the shared graph — is paid
   * by Playwright's `webServer` readiness poll under its own 120s budget,
   * before any test runs. What lands inside the 30s per-test budget is only the
   * incremental per-route compile. Measured against a real ubuntu-latest run,
   * the split moves the worst floor test from ~1.0s to ~3.4s: 11% of the
   * timeout, a ~9x margin.
   *
   * One retry is kept anyway because it costs ~30s on a ~57s job in the worst
   * case. Do not read it as evidence this suite flakes.
   *
   * It also activates `trace: "on-first-retry"` below — but do not expect to
   * ever read that trace. Retries are CI-only, so `on-first-retry` never fires
   * locally, and in CI it fires into a job that uploads no artifacts (its
   * failure message is self-describing, so it never needed the upload step the
   * deleted snapshot job had) and the trace is discarded with the runner. Net:
   * the trace config produces nothing usable anywhere today. To actually get
   * one, run `npx playwright test --trace on` locally; to get one out of CI,
   * add an `actions/upload-artifact` step for `apps/web/test-results/`.
   */
  retries: isCi ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: !isCi,
        timeout: 120_000,
        env: resolvedWebServerEnv(),
      },
});
