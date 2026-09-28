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
      enableInp: false,
    });
    const [options] = sentry.init.mock.calls[0] as [
      { integrations: { name: string }[] },
    ];
    expect(options.integrations.map((i) => i.name)).toEqual([
      "BrowserTracing",
      "UserTiming",
    ]);
  });

  it("does not initialize without a DSN", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    await import("./instrumentation-client");
    expect(sentry.init).not.toHaveBeenCalled();
  });
});
