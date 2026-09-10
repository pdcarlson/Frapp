import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindPostHogAdapterForTests,
  isPostHogReady,
} from "@repo/observability";
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
});
