import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyAnalyticsIdentity,
  applyAnalyticsOptOut,
  bindPostHogAdapterForTests,
} from "@repo/observability/identified-posthog";
import { initWebPostHog } from "./client";

const posthogInit = vi.hoisted(() => vi.fn());
const reloadFeatureFlags = vi.hoisted(() => vi.fn());
const setConfig = vi.hoisted(() => vi.fn());
const optInCapturing = vi.hoisted(() => vi.fn());

vi.mock("posthog-js", () => ({
  default: {
    init: posthogInit,
    identify: vi.fn(),
    reset: vi.fn(),
    group: vi.fn(),
    resetGroups: vi.fn(),
    opt_out_capturing: vi.fn(),
    opt_in_capturing: optInCapturing,
    set_config: setConfig,
    stopSessionRecording: vi.fn(),
    capture: vi.fn(),
    get_session_id: () => "",
    get_distinct_id: () => "",
    sessionRecordingStarted: () => false,
    isFeatureEnabled: () => false,
    reloadFeatureFlags,
  },
}));

afterEach(() => {
  bindPostHogAdapterForTests(null);
  vi.unstubAllEnvs();
  posthogInit.mockClear();
  reloadFeatureFlags.mockClear();
  setConfig.mockClear();
  optInCapturing.mockClear();
});

describe("initWebPostHog", () => {
  it("is a no-op without a key and never opens a transport", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    initWebPostHog();
    initWebPostHog();
    expect(posthogInit).not.toHaveBeenCalled();
  });

  it("initializes exactly once when a key is present", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_write_only");
    initWebPostHog();
    initWebPostHog();
    expect(posthogInit).toHaveBeenCalledTimes(1);
    const options = posthogInit.mock.calls[0]?.[1] as {
      capture_exceptions?: boolean;
      disable_session_recording?: boolean;
    };
    expect(options.capture_exceptions).toBe(false);
    expect(options.disable_session_recording).toBe(true);
  });

  it("reloads vendor flags after a hex identify", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_write_only");
    initWebPostHog();
    applyAnalyticsIdentity({
      enabled: true,
      distinct_id: "a".repeat(64),
      chapter_group_id: null,
    });
    expect(reloadFeatureFlags).toHaveBeenCalledTimes(1);
  });

  // Web opts out on every load until the chapter read answers (#2957). The
  // opt-out's `stopSessionRecording()` latches replay off, and a plain
  // `opt_in_capturing()` never undoes it.
  it("restores the configured replay setting on opt-in, and sends no $opt_in", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_write_only");
    initWebPostHog();
    const options = posthogInit.mock.calls[0]?.[1] as {
      disable_session_recording?: boolean;
    };
    applyAnalyticsOptOut(true);
    applyAnalyticsOptOut(false);
    expect(setConfig).toHaveBeenCalledWith({
      disable_session_recording: options.disable_session_recording,
    });
    expect(optInCapturing).toHaveBeenCalledWith({ captureEventName: false });
    expect(setConfig.mock.invocationCallOrder[0]).toBeLessThan(
      optInCapturing.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
