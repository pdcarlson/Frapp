import { afterEach, describe, expect, it, vi } from "vitest";
import PostHog from "posthog-react-native";
import {
  applyAnalyticsIdentity,
  applyAnalyticsOptOut,
  bindPostHogAdapterForTests,
  createRouteViewRecorder,
  isAnalyticsCaptureOptedOut,
  isPostHogReady,
  resetPostHog,
} from "@repo/observability/identified-posthog";
import { initMobilePostHog } from "./client";

vi.mock("expo-updates", () => ({
  isEnabled: true,
  isEmbeddedLaunch: false,
  isEmergencyLaunch: false,
  updateId: "0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D",
  channel: "production",
  runtimeVersion: "0.12.0",
  createdAt: new Date("2026-11-12T20:00:00.000Z"),
}));

afterEach(() => {
  bindPostHogAdapterForTests(null);
  vi.unstubAllEnvs();
});

describe("initMobilePostHog", () => {
  it("is a no-op without a key and never opens a transport", () => {
    vi.stubEnv("EXPO_PUBLIC_POSTHOG_KEY", "");
    initMobilePostHog();
    initMobilePostHog();
    expect(isPostHogReady()).toBe(false);
  });

  it("initializes exactly once when a key is present", () => {
    vi.stubEnv("EXPO_PUBLIC_POSTHOG_KEY", "phc_test_write_only");
    initMobilePostHog();
    expect(isPostHogReady()).toBe(true);
    initMobilePostHog();
    expect(isPostHogReady()).toBe(true);
  });

  it("tags every event with the update this launch runs, again after a reset", () => {
    const register = vi.spyOn(PostHog.prototype, "register");
    const reset = vi.spyOn(PostHog.prototype, "reset");
    try {
      vi.stubEnv("EXPO_PUBLIC_POSTHOG_KEY", "phc_test_write_only");
      initMobilePostHog();
      const running = expect.objectContaining({
        app_launch: "update",
        app_update_id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
        app_runtime_version: "0.12.0",
      });
      expect(register).toHaveBeenCalledWith(running);
      register.mockClear();
      resetPostHog();
      expect(reset).toHaveBeenCalledTimes(1);
      expect(register).toHaveBeenCalledWith(running);
    } finally {
      register.mockRestore();
      reset.mockRestore();
    }
  });

  it("starts opted out until the chapter's answer arrives (#3101)", () => {
    const optOut = vi.spyOn(PostHog.prototype, "optOut");
    try {
      vi.stubEnv("EXPO_PUBLIC_POSTHOG_KEY", "phc_test_write_only");
      initMobilePostHog();
      expect(optOut).toHaveBeenCalledTimes(1);
      expect(isAnalyticsCaptureOptedOut()).toBe(true);
    } finally {
      optOut.mockRestore();
    }
  });

  it("reloads vendor flags after a hex identify", () => {
    const reload = vi.spyOn(PostHog.prototype, "reloadFeatureFlags");
    try {
      vi.stubEnv("EXPO_PUBLIC_POSTHOG_KEY", "phc_test_write_only");
      initMobilePostHog();
      applyAnalyticsIdentity({
        enabled: true,
        distinct_id: "a".repeat(64),
        chapter_group_id: null,
      });
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      reload.mockRestore();
    }
  });

  // #3382: a route view is `screen(template)`, and nothing while opted out.
  it("sends a route view as screen(template) only once opted in", () => {
    const screen = vi.spyOn(PostHog.prototype, "screen");
    try {
      vi.stubEnv("EXPO_PUBLIC_POSTHOG_KEY", "phc_test_write_only");
      initMobilePostHog();
      const record = createRouteViewRecorder();
      record("/chat-thread");
      expect(screen).not.toHaveBeenCalled();
      applyAnalyticsOptOut(false);
      record("/chat-thread");
      expect(screen).toHaveBeenCalledTimes(1);
      expect(screen).toHaveBeenCalledWith("/chat-thread");
    } finally {
      screen.mockRestore();
    }
  });
});
