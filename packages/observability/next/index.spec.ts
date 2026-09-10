import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as next from "./index";

describe("@repo/observability/next public API", () => {
  it("exports anonymous builders and no identity APIs", () => {
    expect(typeof next.buildAnonymousBrowserSentryOptions).toBe("function");
    expect(typeof next.buildAnonymousServerSentryOptions).toBe("function");
    expect(typeof next.buildAnonymousPostHogBrowserOptions).toBe("function");
    expect(typeof next.attachAnonymousPostHogCorrelation).toBe("function");
    expect(typeof next.withAnonymousPostHogSentryCorrelation).toBe(
      "function",
    );
    expect(typeof next.shouldEnablePostHogReplay).toBe("function");
    expect(next).not.toHaveProperty("getAnonymousSentryBuildConfig");
    expect(typeof next.sanitizeAnonymousPostHogProperties).toBe("function");
    expect(typeof next.sanitizeIdentifiedPostHogCapture).toBe("function");
    expect(next.POSTHOG_PROPERTY_DENYLIST).toEqual([
      "$ip",
      "ip",
      "email",
      "$email",
    ]);

    expect(next).not.toHaveProperty("identify");
    expect(next).not.toHaveProperty("alias");
    expect(next).not.toHaveProperty("group");
    expect(next).not.toHaveProperty("setUser");
    expect(next).not.toHaveProperty("applyAnalyticsIdentity");
    expect(next).not.toHaveProperty("getPostHogDistinctId");
    expect(next).not.toHaveProperty("captureAnalyticsEvent");
    expect(next).not.toHaveProperty("canStartLivePostHogInit");
    expect(next).not.toHaveProperty("setLivePostHogAdapter");
    expect(next).not.toHaveProperty("createMemoryPostHogAdapter");
    expect(next).not.toHaveProperty("isProductFlagEnabled");
  });
});

describe("identity firewall", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(dir).filter(
    (f) =>
      (f.endsWith(".ts") || f.endsWith(".js") || f.endsWith(".mjs")) &&
      !f.endsWith(".spec.ts") &&
      !f.endsWith(".spec.js"),
  );

  it("has production sources to scan", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it("does not call identify, alias, group, or Sentry.setUser", () => {
    for (const file of sources) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).not.toMatch(/Sentry\.setUser\s*\(/);
      expect(source, file).not.toMatch(/\.identify\s*\(/);
      expect(source, file).not.toMatch(/\balias\s*\(/);
      expect(source, file).not.toMatch(/\.group\s*\(/);
      expect(source, file).not.toMatch(/posthog_distinct_id\s*=/);
      expect(source, file).not.toContain("/v1/analytics/identity");
      expect(source, file).not.toContain("process.env.ANALYTICS_HMAC_SALT");
      expect(source, file).not.toContain("process.env.NEXT_PUBLIC_SENTRY_DSN");
      expect(source, file).not.toMatch(
        /from ['"]@repo\/observability\/identified-posthog['"]/,
      );
    }
  });
});
