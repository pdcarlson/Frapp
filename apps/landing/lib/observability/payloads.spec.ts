import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function productionSources(dir: string): string[] {
  return readdirSync(dir)
    .filter(
      (f) =>
        (f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js")) &&
        !f.includes(".spec."),
    )
    .map((f) => join(dir, f));
}

describe("no secrets or PII in landing observability sources", () => {
  it("never reads the HMAC salt, service-role key, or the web Sentry DSN", () => {
    const files = [
      ...productionSources(join(process.cwd(), "lib/posthog")),
      ...productionSources(join(process.cwd(), "lib/sentry")),
      join(process.cwd(), "instrumentation.ts"),
      join(process.cwd(), "instrumentation-client.ts"),
    ];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("process.env.ANALYTICS_HMAC_SALT");
      expect(source, file).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(source, file).not.toContain("POSTHOG_PERSONAL_API_KEY");
      expect(source, file).not.toContain("process.env.NEXT_PUBLIC_SENTRY_DSN");
      expect(source, file).not.toContain("/v1/analytics/identity");
    }
  });

  it("does not identify, alias, group, or set a Sentry user", () => {
    const files = [
      ...productionSources(join(process.cwd(), "lib/posthog")),
      ...productionSources(join(process.cwd(), "lib/sentry")),
      join(process.cwd(), "instrumentation.ts"),
      join(process.cwd(), "instrumentation-client.ts"),
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/\balias\s*\(/);
      expect(source, file).not.toMatch(/\.identify\s*\(/);
      expect(source, file).not.toMatch(/\.group\s*\(/);
      expect(source, file).not.toContain("Sentry.setUser");
      expect(source, file).not.toContain("replayIntegration");
    }
  });

  it("disables PostHog exception autocapture and inits behind a DSN/key gate", () => {
    const posthog = readFileSync(
      join(process.cwd(), "lib/posthog/config.ts"),
      "utf8",
    );
    expect(posthog).toContain(
      "capture_exceptions: POSTHOG_EXCEPTION_AUTOCAPTURE",
    );
    const client = readFileSync(
      join(process.cwd(), "instrumentation-client.ts"),
      "utf8",
    );
    expect(client).toContain("initLandingPostHog");
    expect(client).toContain("withPostHogSentryCorrelation");
    expect(client).toMatch(/if \(dsn\)/);
  });
});
