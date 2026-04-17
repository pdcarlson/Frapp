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
  NEXT_PUBLIC_API_URL: "http://127.0.0.1:3001/v1",
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
