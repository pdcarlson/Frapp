import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function landingObservabilitySources(): string[] {
  const files = [
    join(process.cwd(), "instrumentation.ts"),
    join(process.cwd(), "instrumentation-client.ts"),
  ];
  for (const dir of ["lib/posthog", "lib/sentry"] as const) {
    const abs = join(process.cwd(), dir);
    for (const name of readdirSync(abs)) {
      if (name.includes(".spec.")) continue;
      if (!/\.(ts|tsx|js)$/.test(name)) continue;
      files.push(join(abs, name));
    }
  }
  return files;
}

describe("no secrets or PII in landing observability sources", () => {
  it("never reads the HMAC salt, service-role key, or the web Sentry DSN", () => {
    const files = landingObservabilitySources();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("process.env.ANALYTICS_HMAC_SALT");
      expect(source, file).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(source, file).not.toContain("POSTHOG_PERSONAL_API_KEY");
      expect(source, file).not.toContain("process.env.NEXT_PUBLIC_SENTRY_DSN");
      expect(source, file).not.toContain("/v1/analytics/identity");
      expect(source, file).not.toContain(
        "@repo/observability/identified-posthog",
      );
    }
  });

  it("does not identify, alias, group, or set a Sentry user", () => {
    for (const file of landingObservabilitySources()) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/\balias\s*\(/);
      expect(source, file).not.toMatch(/\.identify\s*\(/);
      expect(source, file).not.toMatch(/\.group\s*\(/);
      expect(source, file).not.toContain("Sentry.setUser(");
      expect(source, file).not.toContain("replayIntegration");
    }
  });

  it("inits PostHog from the anonymous Next builder behind a key/DSN gate", () => {
    const posthog = readFileSync(
      join(process.cwd(), "lib/posthog/config.ts"),
      "utf8",
    );
    expect(posthog).toContain("buildAnonymousPostHogBrowserOptions");
    expect(posthog).toContain('person_profiles: "never"');
    const client = readFileSync(
      join(process.cwd(), "instrumentation-client.ts"),
      "utf8",
    );
    expect(client).toContain("initLandingPostHog");
    expect(client).toContain("withPostHogSentryCorrelation");
    expect(client).toMatch(/if \(dsn\)/);
  });

  it("uploads source maps to frapp-landing and swallows a missing project", () => {
    const nextConfig = readFileSync(
      join(process.cwd(), "next.config.js"),
      "utf8",
    );
    expect(nextConfig).toContain("getAnonymousSentryBuildConfig");
    expect(nextConfig).toContain('project: "frapp-landing"');
    expect(nextConfig).toContain("release: sentryGitSha");
    expect(nextConfig).toContain("errorHandler");
    expect(nextConfig).toContain("NEXT_PUBLIC_LANDING_SENTRY_DSN");
    expect(nextConfig).not.toContain('project: "frapp-web"');
  });
});
