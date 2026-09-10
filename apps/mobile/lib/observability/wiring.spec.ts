import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

describe("mobile observability wiring", () => {
  it("initializes PostHog then wraps Sentry beforeSend, and does not instrument Ask", () => {
    const layout = source("app/_layout.tsx");
    expect(layout).toContain("initMobilePostHog()");
    expect(layout).toContain("withPostHogSentryCorrelation");
    expect(layout).toContain("ObservabilityIdentityProvider");
    expect(layout).not.toContain("lib/ask/corpus");
    expect(layout).not.toMatch(/mobileReplayIntegration/);
  });

  it("uses Sentry Expo Metro with web replay off", () => {
    const metro = source("metro.config.js");
    expect(metro).toContain("getSentryExpoConfig");
    expect(metro).toContain("includeWebReplay: false");
    expect(metro).toContain("includeWebFeedback: false");
    expect(metro).not.toContain("getDefaultConfig");
  });

  it("does not emit PostHog or Sentry from the synthetic Ask corpus", () => {
    const corpus = source("lib/ask/corpus.ts");
    expect(corpus).not.toMatch(/posthog/i);
    expect(corpus).not.toMatch(/Sentry\./);
    expect(corpus).not.toContain("captureException");
    expect(corpus).not.toContain("sentry-error-correlated");
  });

  it("does not depend on PostHog session-replay native or widen React", () => {
    const pkg = JSON.parse(source("package.json")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["posthog-react-native-session-replay"]).toBeUndefined();
    expect(pkg.dependencies.react).toBe("19.2.3");
    expect(pkg.dependencies["react-dom"]).toBe("19.2.3");
    expect(pkg.dependencies["posthog-react-native"]).toBeDefined();
  });
});
