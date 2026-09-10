import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Web-only Sentry wiring: `NEXT_PUBLIC_SENTRY_DSN` and first-party API
 * trace targets. Shared scrub / replay-off / both-hooks cases live in
 * `@repo/observability/next`.
 */

const DSN = "https://examplepublickey@o0.ingest.sentry.io/0";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadOptions() {
  return import("./options");
}

describe("web DSN gating", () => {
  it("reports no DSN when the variable is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    const { webSentryDsn } = await loadOptions();
    expect(webSentryDsn()).toBeUndefined();
  });

  it("returns the DSN when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    const { webSentryDsn } = await loadOptions();
    expect(webSentryDsn()).toBe(DSN);
  });
});

describe("web-only runtime", () => {
  it("reads a valid traces sample rate from env", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE", "0.25");
    const { buildWebSentryOptions } = await loadOptions();
    expect(buildWebSentryOptions(DSN).tracesSampleRate).toBe(0.25);
  });

  it("propagates traces to first-party API origins", async () => {
    const { buildWebSentryOptions } = await loadOptions();
    expect(buildWebSentryOptions(DSN).tracePropagationTargets).toEqual(
      expect.arrayContaining([
        "http://localhost:3001",
        "https://api-staging.frapp.live",
        "https://api.frapp.live",
      ]),
    );
  });

  it("uploads source maps to frapp-web without a landing errorHandler", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const nextConfig = readFileSync(
      join(process.cwd(), "next.config.js"),
      "utf8",
    );
    expect(nextConfig).toContain("getAnonymousSentryBuildConfig");
    expect(nextConfig).toContain('project: "frapp-web"');
    expect(nextConfig).not.toContain("errorHandler");
    expect(nextConfig).not.toContain("frapp-landing");
  });
});

describe("no salt reaches the web bundle", () => {
  it("reads no salt-shaped environment variable anywhere under lib/sentry", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");

    const dir = join(process.cwd(), "lib", "sentry");
    const sources = readdirSync(dir).filter(
      (f) =>
        (f.endsWith(".ts") || f.endsWith(".js")) &&
        !f.endsWith(".spec.ts") &&
        !f.endsWith(".spec.tsx"),
    );
    expect(sources.length).toBeGreaterThan(0);

    for (const file of sources) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source).not.toContain("process.env.ANALYTICS_HMAC_SALT");
      expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    }
  });
});
