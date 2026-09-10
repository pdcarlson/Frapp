import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getSentryBuildConfig } from "./build-config.js";

describe("landing Sentry webpack plugin config", () => {
  it("targets frapp-landing and never disables debug IDs", () => {
    const quiet = getSentryBuildConfig({ authToken: "" });
    expect(quiet).toMatchObject({
      org: "frapp-live",
      project: "frapp-landing",
      telemetry: false,
      silent: true,
      sourcemaps: { disable: false },
    });
    expect(quiet).not.toHaveProperty("debugIds");
    expect(typeof quiet.errorHandler).toBe("function");

    const uploading = getSentryBuildConfig({ authToken: "sntrys_test" });
    expect(uploading.silent).toBe(false);
    expect(uploading.sourcemaps.disable).toBe(false);
  });

  it("next.config.js uses the helper and names the landing DSN", () => {
    const source = readFileSync(join(process.cwd(), "next.config.js"), "utf8");
    expect(source).toMatch(/getSentryBuildConfig/);
    expect(source).toMatch(/VERCEL_GIT_COMMIT_SHA/);
    expect(source).toMatch(/NEXT_PUBLIC_SENTRY_RELEASE/);
    expect(source).toMatch(/LANDING_SENTRY_DSN/);
    expect(source).not.toMatch(
      /sourcemaps:\s*\{\s*disable:\s*!process\.env\.SENTRY_AUTH_TOKEN/,
    );
  });
});
