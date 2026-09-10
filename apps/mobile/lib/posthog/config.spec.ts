import { afterEach, describe, expect, it, vi } from "vitest";
import { POSTHOG_EXCEPTION_AUTOCAPTURE } from "@repo/observability";
import { buildMobilePostHogInitOptions } from "./config";

const HEX = "a".repeat(64);
const CHAPTER_HEX = "b".repeat(64);
const JOIN_WITH_TOKEN =
  "https://app.frapp.live/join?token=invite-token-secret&email=treasurer@chapter.example.edu";
const DEEP_LINK_WITH_TOKEN = "frapp://join?token=invite-token-secret";

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

  it("wires the identified sanitizer, not landing's drop-$set helper", async () => {
    vi.resetModules();
    const { sanitizeIdentifiedPostHogCapture, sanitizeAnonymousPostHogCapture } =
      await import("@repo/observability/next");
    const { buildMobilePostHogInitOptions: build } = await import("./config");
    const options = build({ environment: "preview" });
    expect(options.before_send).toBe(sanitizeIdentifiedPostHogCapture);
    expect(options.before_send).not.toBe(sanitizeAnonymousPostHogCapture);
  });

  it("path-only-reduces join-token URLs on identify and capture", () => {
    const options = buildMobilePostHogInitOptions({ environment: "preview" });
    const sanitize = options.before_send;
    expect(typeof sanitize).toBe("function");
    if (typeof sanitize !== "function") {
      throw new Error("expected before_send to be a function");
    }

    const identify = sanitize({
      event: "$identify",
      properties: {
        $current_url: JOIN_WITH_TOKEN,
        $pathname: "/join?token=invite-token-secret",
        $referrer: "https://frapp.live/privacy?ref=abc",
        $initial_current_url: DEEP_LINK_WITH_TOKEN,
        $ip: "203.0.113.9",
        email: "treasurer@chapter.example.edu",
        $groups: { chapter: CHAPTER_HEX },
        $set: { $initial_current_url: JOIN_WITH_TOKEN },
      },
      $set: {
        distinct_id: HEX,
        $initial_current_url: JOIN_WITH_TOKEN,
        email: "treasurer@chapter.example.edu",
      },
    });
    expect(identify?.properties).toEqual({
      $current_url: "/join",
      $pathname: "/join",
      $referrer: "/privacy",
      $initial_current_url: "/",
      $groups: { chapter: CHAPTER_HEX },
      $set: { $initial_current_url: "/join" },
    });
    expect(identify?.$set).toEqual({
      distinct_id: HEX,
      $initial_current_url: "/join",
    });

    const capture = sanitize({
      event: "sentry-error-correlated",
      properties: {
        $current_url: JOIN_WITH_TOKEN,
        $pathname: "/join?token=invite-token-secret",
      },
    });
    expect(capture?.properties).toEqual({
      $current_url: "/join",
      $pathname: "/join",
    });

    const json = `${JSON.stringify(identify)}${JSON.stringify(capture)}`;
    expect(json).not.toContain("invite-token-secret");
    expect(json).not.toContain("treasurer@chapter.example.edu");
    expect(json).not.toContain("203.0.113.9");
    expect(json).not.toContain("?");
    expect(json).toContain(HEX);
    expect(json).toContain(CHAPTER_HEX);
  });
});
