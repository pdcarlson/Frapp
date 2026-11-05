import { afterEach, describe, expect, it, vi } from "vitest";
import PostHog from "posthog-react-native";
import {
  applyAnalyticsIdentity,
  applyAnalyticsOptOut,
  bindPostHogAdapterForTests,
  captureRouteView,
  isAnalyticsCaptureOptedOut,
  isPostHogReady,
} from "@repo/observability/identified-posthog";
import { initMobilePostHog } from "./client";

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
      captureRouteView("/chat-thread");
      expect(screen).not.toHaveBeenCalled();
      applyAnalyticsOptOut(false);
      captureRouteView("/chat-thread");
      expect(screen).toHaveBeenCalledTimes(1);
      expect(screen).toHaveBeenCalledWith("/chat-thread");
    } finally {
      screen.mockRestore();
    }
  });
});
