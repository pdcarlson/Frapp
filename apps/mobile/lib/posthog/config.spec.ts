import { afterEach, describe, expect, it, vi } from "vitest";
import {
  POSTHOG_EXCEPTION_AUTOCAPTURE,
  POSTHOG_PRODUCTION_REPLAY_ENABLED,
} from "@repo/observability";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load() {
  return import("./config");
}

describe("PostHog RN credentials", () => {
  it("is unconfigured when the write-only key is unset", async () => {
    vi.stubEnv("EXPO_PUBLIC_POSTHOG_KEY", "");
    const { isPostHogConfigured, mobilePostHogKey } = await load();
    expect(mobilePostHogKey()).toBeUndefined();
    expect(isPostHogConfigured()).toBe(false);
  });

  it("reads the host from env and defaults to US Cloud", async () => {
    vi.stubEnv("EXPO_PUBLIC_POSTHOG_HOST", "");
    const { mobilePostHogHost } = await load();
    expect(mobilePostHogHost()).toBe("https://us.i.posthog.com");
  });
});

describe("replay decision", () => {
  it("cannot turn production replay on while the policy constant is false", async () => {
    const { shouldEnablePostHogReplay } = await load();
    expect(POSTHOG_PRODUCTION_REPLAY_ENABLED).toBe(false);
    expect(shouldEnablePostHogReplay({ environment: "production" })).toBe(
      false,
    );
    expect(shouldEnablePostHogReplay({ environment: "preview" })).toBe(false);
    expect(shouldEnablePostHogReplay({ environment: "development" })).toBe(
      false,
    );
  });
});

describe("init options the app ships", () => {
  it("disables exception autocapture, lifecycle events, and session replay", async () => {
    const { buildMobilePostHogInitOptions } = await load();
    const options = buildMobilePostHogInitOptions({
      environment: "preview",
    });
    expect(options.errorTracking?.autocapture).toBe(
      POSTHOG_EXCEPTION_AUTOCAPTURE,
    );
    expect(options.errorTracking?.autocapture).toBe(false);
    expect(options.captureAppLifecycleEvents).toBe(false);
    expect(options.enableSessionReplay).toBe(false);
    expect(options.personProfiles).toBe("identified_only");
    expect(options.sessionReplayConfig?.maskAllTextInputs).toBe(true);
    expect(options.sessionReplayConfig?.maskAllImages).toBe(true);
    expect(options.sessionReplayConfig?.maskAllSandboxedViews).toBe(true);
    expect(options.sessionReplayConfig?.captureLog).toBe(false);
    expect(options.sessionReplayConfig?.captureNetworkTelemetry).toBe(false);
    expect(options.sessionReplayConfig?.sampleRate).toBe(0);
    expect(options.capturePushNotificationSubscriptions).toBe(false);
    expect(options.capturePushNotificationOpened).toBe(false);
  });

  it("still disables recording when asked for production", async () => {
    const { buildMobilePostHogInitOptions } = await load();
    const options = buildMobilePostHogInitOptions({
      environment: "production",
    });
    expect(options.enableSessionReplay).toBe(false);
  });
});
