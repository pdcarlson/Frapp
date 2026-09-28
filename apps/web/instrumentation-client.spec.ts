import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { SENTRY_BROWSER_TRACING_OPTIONS } from "@repo/observability/next";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * What `instrumentation-client.ts` hands `Sentry.init` (#2722).
 *
 * The SDK is mocked, so this pins the wiring, not the SDK: the option
 * objects are real, and so is the file under test. Two integrations are the
 * point. `userTimingIntegration` is what still turns the cold-load
 * `performance.mark`s into spans under SDK v11, and a `browserTracingIntegration`
 * built with `SENTRY_BROWSER_TRACING_OPTIONS` is what keeps INP (a DOM
 * selector, member and channel names included) from leaving. Dropping either
 * line changes nothing any other test can see.
 */

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  browserTracingIntegration: vi.fn((options: unknown) => ({
    name: "BrowserTracing",
    options,
  })),
  userTimingIntegration: vi.fn(() => ({ name: "UserTiming" })),
  captureRouterTransitionStart: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => sentry);
vi.mock("@/lib/posthog/client", () => ({ initWebPostHog: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("web browser Sentry init", () => {
  it("replaces browser tracing with INP off and adds user timing", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_SENTRY_DSN",
      "https://fixturekey@o0.ingest.example.invalid/1",
    );
    await import("./instrumentation-client");

    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.browserTracingIntegration).toHaveBeenCalledWith({
      webVitals: { ignore: ["inp"] },
    });
    const [options] = sentry.init.mock.calls[0] as [
      { integrations: { name: string }[] },
    ];
    expect(options.integrations.map((i) => i.name)).toEqual([
      "BrowserTracing",
      "UserTiming",
    ]);
  });

  it("builds an integration the SDK's default of that name gives way to", async () => {
    // The mock above names its instance itself, so this checks the real SDK:
    // the app's instance only replaces the default one when the names match.
    // If they drifted apart, both would run and the default would turn INP
    // back on with every other test here still green.
    // The client build by path: the package's `exports` resolve the server
    // build here, and it has no `browserTracingIntegration`.
    const clientBuild = join(
      dirname(createRequire(import.meta.url).resolve("@sentry/nextjs/package.json")),
      "build/cjs/index.client.js",
    );
    const actual =
      await vi.importActual<typeof import("@sentry/nextjs")>(clientBuild);
    const ours = actual.browserTracingIntegration(
      SENTRY_BROWSER_TRACING_OPTIONS,
    );
    // The real Next client init, with its own defaults and dedupe, and a
    // transport that sends nothing.
    actual.init({
      dsn: "https://fixturekey@o0.ingest.example.invalid/1",
      integrations: [ours],
      transport: () => ({
        send: () => Promise.resolve({}),
        flush: () => Promise.resolve(true),
      }),
    });
    try {
      // Looked up by the DEFAULT instance's name: the one kept under it must
      // be ours, or the default (INP on) is what runs.
      const defaultName = actual.browserTracingIntegration().name;
      expect(actual.getClient()?.getIntegrationByName(defaultName)).toBe(ours);
    } finally {
      await actual.close(0);
    }
  });

  it("does not initialize without a DSN", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    await import("./instrumentation-client");
    expect(sentry.init).not.toHaveBeenCalled();
  });
});
