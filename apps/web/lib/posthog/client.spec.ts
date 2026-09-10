import { afterEach, describe, expect, it, vi } from "vitest";
import { bindPostHogAdapterForTests } from "@repo/observability";
import { initWebPostHog } from "./client";

const posthogInit = vi.hoisted(() => vi.fn());

vi.mock("posthog-js", () => ({
  default: {
    init: posthogInit,
    identify: vi.fn(),
    reset: vi.fn(),
    group: vi.fn(),
    resetGroups: vi.fn(),
    opt_out_capturing: vi.fn(),
    opt_in_capturing: vi.fn(),
    stopSessionRecording: vi.fn(),
    capture: vi.fn(),
    get_session_id: () => "",
    get_distinct_id: () => "",
    sessionRecordingStarted: () => false,
    isFeatureEnabled: () => false,
  },
}));

afterEach(() => {
  bindPostHogAdapterForTests(null);
  vi.unstubAllEnvs();
  posthogInit.mockClear();
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
});
