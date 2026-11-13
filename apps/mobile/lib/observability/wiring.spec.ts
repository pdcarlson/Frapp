import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

describe("mobile observability wiring", () => {
  it("initializes PostHog then wraps Sentry beforeSend", () => {
    const layout = source("app/_layout.tsx");
    expect(layout).toContain("initMobilePostHog()");
    expect(layout).toContain("withPostHogSentryCorrelation");
    expect(layout).toContain("ObservabilityIdentityProvider");
    expect(layout).not.toMatch(/mobileReplayIntegration/);
  });

  it("times each route's first frame, so screen-ready budgets have spans to sit on (#4342)", () => {
    const layout = source("app/_layout.tsx");
    expect(layout).toMatch(
      /expoRouterIntegration\(\{\s*enableTimeToInitialDisplay:\s*true\s*\}\)/,
    );
  });

  it("uses Sentry Expo Metro with web replay off", () => {
    const metro = source("metro.config.js");
    expect(metro).toContain("getSentryExpoConfig");
    expect(metro).toContain("includeWebReplay: false");
    expect(metro).toContain("includeWebFeedback: false");
    expect(metro).not.toContain("getDefaultConfig");
  });

  it("sends no question, answer or source text from Ask to PostHog or Sentry", () => {
    // `00-rules`: no prompt or answer text in any log or event. The Ask
    // surfaces report nothing of their own; the API owns Ask's telemetry.
    for (const file of [
      "components/ask/ask-sheet.tsx",
      "components/ask/ask-turn.tsx",
      "components/ask/ask-proposal.tsx",
      "lib/ask/source-route.ts",
      "components/minutes/notes-draft-sheet.tsx",
    ]) {
      const text = source(file);
      expect(text).not.toMatch(/posthog/i);
      expect(text).not.toMatch(/Sentry\./);
      expect(text).not.toContain("captureException");
      expect(text).not.toMatch(/console\.(log|warn|error)/);
    }
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
