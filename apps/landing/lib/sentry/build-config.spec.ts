import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getSentryBuildConfig } from "./build-config.js";

describe("getSentryBuildConfig", () => {
  it("always enables source maps / debug IDs and stays silent without a token", () => {
    const withoutToken = getSentryBuildConfig({ authToken: "" });
    expect(withoutToken.sourcemaps.disable).toBe(false);
    expect(withoutToken.silent).toBe(true);
    expect(withoutToken.telemetry).toBe(false);
    expect(withoutToken.org).toBe("frapp-live");
    expect(withoutToken.project).toBe("frapp-landing");
    expect(withoutToken).not.toHaveProperty("debugIds");
    expect(JSON.stringify(withoutToken)).not.toContain('"debugIds":false');
    expect(typeof withoutToken.errorHandler).toBe("function");

    const withToken = getSentryBuildConfig({ authToken: "sntrys_test" });
    expect(withToken.sourcemaps.disable).toBe(false);
    expect(withToken.silent).toBe(false);
  });

  it("is what next.config.js actually passes to withSentryConfig", () => {
    const nextConfig = readFileSync(
      join(process.cwd(), "next.config.js"),
      "utf8",
    );
    expect(nextConfig).toContain("getSentryBuildConfig");
    expect(nextConfig).toContain("NEXT_PUBLIC_SENTRY_RELEASE");
    expect(nextConfig).toContain("VERCEL_GIT_COMMIT_SHA");
    expect(nextConfig).toContain("NEXT_PUBLIC_LANDING_SENTRY_DSN");
    expect(nextConfig).not.toMatch(
      /sourcemaps:\s*\{\s*disable:\s*!process\.env\.SENTRY_AUTH_TOKEN/,
    );
  });
});
