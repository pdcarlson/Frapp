import { defineConfig } from "@playwright/test";

const isCi = Boolean(process.env.CI);

/**
 * Benign defaults for the Playwright `webServer` invocation.
 *
 * The visual regression suite boots `npm run dev` inside CI, which does not
 * have Supabase credentials available. These placeholders let Next.js finish
 * its boot handshake (the shape is a valid HTTP URL and a well-formed JWT-ish
 * string) so pages render and the screenshots can be captured.
 * `SUPABASE_AUTH_BYPASS` tells the proxy (`apps/web/proxy.ts`) to skip auth
 * redirects entirely, so protected routes render their actual content instead
 * of redirecting to `/sign-in`. Real deployments always provide the production
 * values via Vercel + Infisical and never set the bypass flag.
 */
const webServerEnvDefaults: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiJ9.visual-regression-stand-in.signature",
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
   * That is survivable for the advisory snapshot job and not for
   * `web-responsive-floor`, which is a required check: the gate would report
   * success having measured one route of fifteen — the same silent-coverage
   * loss it exists to catch. `--grep @floor` matching nothing already exits 1;
   * this closes the other direction.
   */
  forbidOnly: isCi,
  /**
   * Insurance, not a fix for a measured problem — stated that way because the
   * obvious reading of #1152 is wrong and worth writing down.
   *
   * Splitting the floor suite into its own job means it no longer inherits warm
   * route compiles from the snapshot suite that used to run before it in the
   * same worker, so it now pays every route's first Turbopack compile itself.
   * That sounds like it should matter for a required check and does not: the
   * expensive part of a cold `next dev` — boot plus the shared graph — is paid
   * by Playwright's `webServer` readiness poll under its own 120s budget,
   * before any test runs. What lands inside the 30s per-test budget is only the
   * incremental per-route compile. Measured against a real ubuntu-latest run,
   * the split moves the worst floor test from ~1.0s to ~3.4s: 11% of the
   * timeout, a ~9x margin.
   *
   * One retry is kept anyway because it costs ~30s on a ~57s job in the worst
   * case, and because it activates `trace: "on-first-retry"` below, which was
   * dead config at `retries: 0`. Do not read it as evidence this suite flakes.
   */
  retries: isCi ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
    },
  },
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
