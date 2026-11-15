import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyAnalyticsIdentity,
  applyAnalyticsOptOut,
  bindPostHogAdapterForTests,
  createRouteViewRecorder,
} from "@repo/observability/identified-posthog";
import { initWebPostHog, type PostHogLoadSchedule } from "./client";

/** Loads the SDK straight away instead of after `load` and an idle callback. */
const now: PostHogLoadSchedule = (start) => start();

const posthogInit = vi.hoisted(() => vi.fn());
const reloadFeatureFlags = vi.hoisted(() => vi.fn());
const setConfig = vi.hoisted(() => vi.fn());
const optInCapturing = vi.hoisted(() => vi.fn());
const posthogCapture = vi.hoisted(() => vi.fn());
// Replay is off in every environment today, so the real options can't tell a
// restored setting from a latched one. Tests that need replay on set this.
const replayOn = vi.hoisted(() => ({ value: false }));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    buildWebPostHogInitOptions: () => ({
      ...actual.buildWebPostHogInitOptions(),
      ...(replayOn.value ? { disable_session_recording: false } : {}),
    }),
  };
});

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
    capture: posthogCapture,
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
  posthogCapture.mockClear();
  replayOn.value = false;
});

describe("initWebPostHog", () => {
  it("is a no-op without a key and never opens a transport", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    expect(initWebPostHog(now)).toBeUndefined();
    expect(initWebPostHog(now)).toBeUndefined();
    expect(posthogInit).not.toHaveBeenCalled();
  });

  it("initializes exactly once when a key is present", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_write_only");
    await initWebPostHog(now);
    expect(initWebPostHog(now)).toBeUndefined();
    expect(posthogInit).toHaveBeenCalledTimes(1);
    const options = posthogInit.mock.calls[0]?.[1] as {
      capture_exceptions?: boolean;
      disable_session_recording?: boolean;
    };
    expect(options.capture_exceptions).toBe(false);
    expect(options.disable_session_recording).toBe(true);
  });

  it("reloads vendor flags after a hex identify", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_write_only");
    await initWebPostHog(now);
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
  it("restores the configured replay setting on opt-in, and sends no $opt_in", async () => {
    replayOn.value = true;
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_write_only");
    await initWebPostHog(now);
    applyAnalyticsOptOut(true);
    applyAnalyticsOptOut(false);
    expect(setConfig).toHaveBeenCalledWith({
      disable_session_recording: false,
    });
    expect(optInCapturing).toHaveBeenCalledWith({ captureEventName: false });
    expect(setConfig.mock.invocationCallOrder[0]).toBeLessThan(
      optInCapturing.mock.invocationCallOrder[0] ?? 0,
    );
  });

  // #3382: a route view is a `$pageview` whose URL properties are the
  // template, so posthog-js never fills them from `window.location`.
  it("sends a route view as a $pageview with the template as its URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_write_only");
    await initWebPostHog(now);
    const record = createRouteViewRecorder();
    record("/events/3f2a9c1e-4b5d-4e6f-8a7b-9c0d1e2f3a4b?id=x");
    expect(posthogCapture).toHaveBeenCalledWith("$pageview", {
      $pathname: "/events/[id]",
      $current_url: "/events/[id]",
    });
    applyAnalyticsOptOut(true);
    record("/chat");
    expect(posthogCapture).toHaveBeenCalledTimes(1);
  });

  // #3716: the SDK loads after first paint, so what the app does before it
  // arrives has to wait for it, in order, and an opted-out capture must not.
  it("loads the SDK only when scheduled, and replays earlier calls in order", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_write_only");
    let start: (() => void) | undefined;
    const loaded = initWebPostHog((s) => {
      start = s;
    });
    const record = createRouteViewRecorder();
    record("/chat");
    applyAnalyticsIdentity({
      enabled: true,
      distinct_id: "a".repeat(64),
      chapter_group_id: null,
    });
    applyAnalyticsOptOut(true);
    record("/events");
    expect(posthogInit).not.toHaveBeenCalled();
    expect(posthogCapture).not.toHaveBeenCalled();

    start?.();
    await loaded;
    expect(posthogInit).toHaveBeenCalledTimes(1);
    expect(posthogCapture).toHaveBeenCalledTimes(1);
    expect(posthogCapture).toHaveBeenCalledWith("$pageview", {
      $pathname: "/chat",
      $current_url: "/chat",
    });
    expect(reloadFeatureFlags).toHaveBeenCalledTimes(1);
    expect(posthogInit.mock.invocationCallOrder[0]).toBeLessThan(
      posthogCapture.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
