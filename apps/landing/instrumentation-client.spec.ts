import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * What `instrumentation-client.ts` hands `Sentry.init` (#2722).
 *
 * The SDK is mocked, so this pins the wiring, not the SDK: the option
 * objects are real, and so is the file under test. A
 * `browserTracingIntegration` built with `SENTRY_BROWSER_TRACING_OPTIONS` is
 * what keeps INP (a DOM selector, aria-labels included) from leaving;
 * dropping it changes nothing any other test can see. Landing emits no
 * cold-load marks, so unlike web it adds no `userTimingIntegration`.
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
vi.mock("./lib/posthog/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/posthog/client")>()),
  initLandingPostHog: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("landing browser Sentry init", () => {
  it("replaces browser tracing with INP off", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_LANDING_SENTRY_DSN",
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
    ]);
  });

  it("does not initialize without a DSN", async () => {
    vi.stubEnv("NEXT_PUBLIC_LANDING_SENTRY_DSN", "");
    await import("./instrumentation-client");
    expect(sentry.init).not.toHaveBeenCalled();
  });
});
