import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyAnalyticsIdentity,
  applyAnalyticsOptOut,
  bindPostHogAdapterForTests,
  captureSentryErrorCorrelated,
  createRouteViewRecorder,
  isAnalyticsCaptureOptedOut,
} from "@repo/observability/identified-posthog";
import { initWebPostHog, type PostHogLoadSchedule } from "./client";

/** Loads the SDK straight away instead of after `load` and an idle callback. */
const now: PostHogLoadSchedule = (start) => start();

const posthogInit = vi.hoisted(() => vi.fn());
const reloadFeatureFlags = vi.hoisted(() => vi.fn());
const setConfig = vi.hoisted(() => vi.fn());
const optInCapturing = vi.hoisted(() => vi.fn());
const posthogCapture = vi.hoisted(() => vi.fn());
const posthogIdentify = vi.hoisted(() => vi.fn());
const optOutCapturing = vi.hoisted(() => vi.fn());
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
    identify: posthogIdentify,
    reset: vi.fn(),
    group: vi.fn(),
    resetGroups: vi.fn(),
    opt_out_capturing: optOutCapturing,
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
  posthogCapture.mockReset();
  posthogIdentify.mockClear();
  optOutCapturing.mockClear();
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
    applyAnalyticsOptOut(false);
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
    // The chapter read answers "opted in" before the SDK arrives.
    applyAnalyticsOptOut(false);
    const record = createRouteViewRecorder();
    const before = Date.now();
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
    expect(posthogIdentify).not.toHaveBeenCalled();

    start?.();
    await loaded;
    expect(posthogInit).toHaveBeenCalledTimes(1);
    // The view made before the opt-out, and only that one.
    expect(posthogCapture).toHaveBeenCalledTimes(1);
    const [event, properties, options] = posthogCapture.mock.calls[0] ?? [];
    expect(event).toBe("$pageview");
    expect(properties).toEqual({ $pathname: "/chat", $current_url: "/chat" });
    // Stamped when it was made, not when the SDK arrived.
    expect(
      (options as { timestamp: Date }).timestamp.getTime(),
    ).toBeGreaterThanOrEqual(before);
    expect(posthogIdentify).toHaveBeenCalledWith("a".repeat(64));
    // Init's opt-out (#3477), then the one made after the view.
    expect(optOutCapturing).toHaveBeenCalledTimes(2);
    const order = [
      posthogInit,
      optInCapturing,
      posthogCapture,
      posthogIdentify,
      reloadFeatureFlags,
    ].map((fn) => fn.mock.invocationCallOrder[0] ?? 0);
    order.push(optOutCapturing.mock.invocationCallOrder[1] ?? 0);
    expect(optOutCapturing.mock.invocationCallOrder[0]).toBeLessThan(
      optInCapturing.mock.invocationCallOrder[0] ?? 0,
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("caps queued events but never a consent call made after them", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_write_only");
    let start: (() => void) | undefined;
    const loaded = initWebPostHog((s) => {
      start = s;
    });
    applyAnalyticsOptOut(false);
    for (let i = 0; i < 250; i += 1) {
      captureSentryErrorCorrelated({ sentry_event_id: `e${i}` });
    }
    applyAnalyticsOptOut(true);
    start?.();
    await loaded;
    expect(posthogCapture).toHaveBeenCalledTimes(200);
    expect(optOutCapturing).toHaveBeenCalledTimes(2);
  });

  // #3477: until the chapter read answers, web is opted out, as mobile is
  // (#3101). A capture made in that window is dropped, not queued, and the
  // SDK's first call once it loads is the opt-out.
  it("starts opted out until the chapter's answer arrives (#3477)", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_write_only");
    let start: (() => void) | undefined;
    const loaded = initWebPostHog((s) => {
      start = s;
    });
    expect(isAnalyticsCaptureOptedOut()).toBe(true);
    captureSentryErrorCorrelated({ sentry_event_id: "hydration" });
    createRouteViewRecorder()("/chat");
    start?.();
    await loaded;
    expect(posthogCapture).not.toHaveBeenCalled();
    expect(optOutCapturing).toHaveBeenCalledTimes(1);
    expect(posthogInit.mock.invocationCallOrder[0]).toBeLessThan(
      optOutCapturing.mock.invocationCallOrder[0] ?? 0,
    );
    // Flags still load for a chapter that opts in once it answers.
    applyAnalyticsOptOut(false);
    applyAnalyticsIdentity({
      enabled: true,
      distinct_id: "b".repeat(64),
      chapter_group_id: null,
    });
    expect(reloadFeatureFlags).toHaveBeenCalledTimes(1);
    expect(optInCapturing).toHaveBeenCalledWith({ captureEventName: false });
  });

  it("keeps replaying after one queued call throws", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_write_only");
    let start: (() => void) | undefined;
    const loaded = initWebPostHog((s) => {
      start = s;
    });
    posthogCapture.mockImplementationOnce(() => {
      throw new Error("before_send threw");
    });
    applyAnalyticsOptOut(false);
    createRouteViewRecorder()("/chat");
    applyAnalyticsOptOut(true);
    start?.();
    await loaded;
    expect(posthogCapture).toHaveBeenCalledTimes(1);
    expect(optOutCapturing).toHaveBeenCalledTimes(2);
  });
});
