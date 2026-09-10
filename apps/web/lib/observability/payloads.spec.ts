import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = [
  join(process.cwd(), "lib/posthog"),
  join(process.cwd(), "lib/sentry"),
  join(process.cwd(), "lib/observability"),
  join(process.cwd(), "lib/providers"),
];

function productionSources(dir: string): string[] {
  return readdirSync(dir)
    .filter(
      (f) =>
        (f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js")) &&
        !f.includes(".spec."),
    )
    .map((f) => join(dir, f));
}

describe("no secrets or PII in web observability sources", () => {
  it("never reads the HMAC salt or service-role key", () => {
    const files = ROOTS.flatMap(productionSources);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("process.env.ANALYTICS_HMAC_SALT");
      expect(source, file).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(source, file).not.toContain("POSTHOG_PERSONAL_API_KEY");
    }
  });

  it("does not enable Sentry Replay or PostHog exception autocapture in shipped sources", () => {
    const sentry = readFileSync(
      join(process.cwd(), "lib/sentry/options.ts"),
      "utf8",
    );
    expect(sentry).not.toContain("replayIntegration");
    const posthog = readFileSync(
      join(process.cwd(), "lib/posthog/config.ts"),
      "utf8",
    );
    expect(posthog).toContain("buildAnonymousPostHogBrowserOptions");
    expect(posthog).not.toMatch(/capture_exceptions:\s*true/);
    const sharedPosthog = readFileSync(
      join(
        process.cwd(),
        "../../packages/observability/next/posthog-options.ts",
      ),
      "utf8",
    );
    expect(sharedPosthog).toContain(
      "capture_exceptions: POSTHOG_EXCEPTION_AUTOCAPTURE",
    );
    const client = readFileSync(
      join(process.cwd(), "instrumentation-client.ts"),
      "utf8",
    );
    expect(client).toContain("initWebPostHog");
    expect(client).toContain("withPostHogSentryCorrelation");
    expect(client).toMatch(/if \(dsn\)/);
  });
});
