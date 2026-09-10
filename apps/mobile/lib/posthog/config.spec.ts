import { afterEach, describe, expect, it, vi } from "vitest";
import { POSTHOG_EXCEPTION_AUTOCAPTURE } from "@repo/observability";
import { buildMobilePostHogInitOptions } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Expo PostHog write-only credentials", () => {
  it("treats a missing EXPO_PUBLIC_POSTHOG_KEY as unconfigured", async () => {
    vi.stubEnv("EXPO_PUBLIC_POSTHOG_KEY", "");
    const { isPostHogConfigured, mobilePostHogKey } = await import("./config");
    expect(mobilePostHogKey()).toBeUndefined();
    expect(isPostHogConfigured()).toBe(false);
  });

  it("defaults the ingest host to US Cloud", async () => {
    vi.stubEnv("EXPO_PUBLIC_POSTHOG_HOST", "");
    const { mobilePostHogHost } = await import("./config");
    expect(mobilePostHogHost()).toBe("https://us.i.posthog.com");
  });
});

describe("RN init options the app ships", () => {
  it("keeps autocapture, lifecycle, push, and replay off", () => {
    const options = buildMobilePostHogInitOptions({ environment: "preview" });
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

  it("does not enable recording for a production environment argument", () => {
    const options = buildMobilePostHogInitOptions({
      environment: "production",
    });
    expect(options.enableSessionReplay).toBe(false);
  });
});
