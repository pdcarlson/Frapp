import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * What `instrumentation-client.ts` hands `Sentry.init` (#2722, #2736).
 *
 * The SDK is mocked, so this pins the wiring, not the SDK: the option
 * objects are real, and so is the file under test. Two integrations are the
 * point. `userTimingIntegration` is what still turns the cold-load
 * `performance.mark`s into spans under SDK v11, and
 * `sentryEnvelopeScrubIntegration` is what keeps the INP span's selector
 * (member and channel names included) from leaving. Dropping either line
 * changes nothing any other test here can see;
 * `instrumentation-client.envelope.spec.ts` runs the real SDK through the
 * same file and reads what reaches the transport.
 */

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
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
  it("adds user timing and the envelope scrubber to the defaults", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_SENTRY_DSN",
      "https://fixturekey@o0.ingest.example.invalid/1",
    );
    await import("./instrumentation-client");

    expect(sentry.init).toHaveBeenCalledTimes(1);
    const [options] = sentry.init.mock.calls[0] as [
      { integrations: { name: string }[] },
    ];
    // An array is added to the SDK's defaults, so the default
    // `browserTracingIntegration` (INP on) still runs.
    expect(options.integrations.map((i) => i.name)).toEqual([
      "UserTiming",
      "FrappEnvelopeScrub",
    ]);
  });

  it("does not initialize without a DSN", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    await import("./instrumentation-client");
    expect(sentry.init).not.toHaveBeenCalled();
  });
});
