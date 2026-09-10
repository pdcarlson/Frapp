import { afterEach, describe, expect, it, vi } from "vitest";
import PostHog from "posthog-react-native";
import {
  applyAnalyticsIdentity,
  bindPostHogAdapterForTests,
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
});
