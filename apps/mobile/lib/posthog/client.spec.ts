import { afterEach, describe, expect, it, vi } from "vitest";
import { SENTRY_ERROR_CORRELATED_EVENT } from "@repo/observability";
import {
  applyAnalyticsIdentity,
  applyAnalyticsOptOut,
  bindPostHogAdapterForTests,
  captureSentryErrorCorrelated,
  createMemoryPostHogAdapter,
  getPostHogReplayId,
  initMobilePostHog,
  isProductFlagEnabled,
  resetPostHog,
} from "./client";

const HEX = "a".repeat(64);
const OTHER = "b".repeat(64);
const UUID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const EMAIL = "treasurer@chapter.example.edu";

const PostHogCtor = vi.hoisted(() => vi.fn());

vi.mock("posthog-react-native", () => ({
  default: class {
    constructor(...args: unknown[]) {
      PostHogCtor(...args);
    }
    identify() {}
    reset() {}
    group() {}
    register() {}
    resetGroupPropertiesForFlags() {}
    optOut() {}
    optIn() {}
    stopSessionRecording() {}
    capture() {}
    getSessionId() {
      return "";
    }
    getDistinctId() {
      return "";
    }
    isFeatureEnabled() {
      return false;
    }
  },
}));

afterEach(() => {
  bindPostHogAdapterForTests(null);
  vi.unstubAllEnvs();
  PostHogCtor.mockClear();
});

describe("initMobilePostHog", () => {
  it("is a no-op without a key and never opens a transport", () => {
    vi.stubEnv("EXPO_PUBLIC_POSTHOG_KEY", "");
    initMobilePostHog();
    initMobilePostHog();
    expect(PostHogCtor).not.toHaveBeenCalled();
  });

  it("initializes exactly once when a key is present", () => {
    vi.stubEnv("EXPO_PUBLIC_POSTHOG_KEY", "phc_test_write_only");
    initMobilePostHog();
    initMobilePostHog();
    expect(PostHogCtor).toHaveBeenCalledTimes(1);
    const options = PostHogCtor.mock.calls[0]?.[1] as {
      errorTracking?: { autocapture?: boolean };
      enableSessionReplay?: boolean;
    };
    expect(options.errorTracking?.autocapture).toBe(false);
    expect(options.enableSessionReplay).toBe(false);
  });
});

describe("identity, groups, logout, opt-out", () => {
  it("identifies and groups only with validated hex, then resets on logout", () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);

    applyAnalyticsIdentity({
      enabled: true,
      distinct_id: HEX,
      chapter_group_id: OTHER,
    });
    expect(memory.calls).toEqual([
      { type: "identify", distinctId: HEX },
      { type: "group", groupType: "chapter", groupKey: OTHER },
    ]);

    applyAnalyticsIdentity({
      enabled: true,
      distinct_id: HEX,
      chapter_group_id: null,
    });
    expect(memory.calls.at(-1)).toEqual({ type: "resetGroups" });

    applyAnalyticsIdentity({
      enabled: true,
      distinct_id: UUID,
      chapter_group_id: HEX,
    });
    expect(
      memory.calls.filter((c) => c.type === "identify").map((c) =>
        c.type === "identify" ? c.distinctId : "",
      ),
    ).not.toContain(UUID);

    applyAnalyticsIdentity({
      enabled: true,
      distinct_id: EMAIL,
      chapter_group_id: HEX,
    });
    expect(JSON.stringify(memory.calls)).not.toContain(EMAIL);

    resetPostHog();
    expect(memory.calls.at(-1)).toEqual({ type: "reset" });
  });

  it("stops capturing and replay immediately on opt-out", () => {
    const memory = createMemoryPostHogAdapter();
    memory.setRecording(true);
    bindPostHogAdapterForTests(memory.adapter);
    expect(getPostHogReplayId()).toBe("ph_session_test");

    applyAnalyticsOptOut(true);
    expect(memory.calls).toEqual(
      expect.arrayContaining([
        { type: "optOut" },
        { type: "stopSessionRecording" },
      ]),
    );
    expect(getPostHogReplayId()).toBeUndefined();
    expect(isProductFlagEnabled("anything")).toBe(false);

    captureSentryErrorCorrelated({ sentry_event_id: "abc" });
    expect(memory.calls.some((c) => c.type === "capture")).toBe(false);

    applyAnalyticsIdentity({
      enabled: true,
      distinct_id: HEX,
      chapter_group_id: OTHER,
    });
    expect(memory.calls).toEqual(
      expect.arrayContaining([
        { type: "identify", distinctId: HEX },
        { type: "group", groupType: "chapter", groupKey: OTHER },
      ]),
    );
  });
});

describe("sentry-error-correlated marker", () => {
  it("emits only allowlisted content-free properties", () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    captureSentryErrorCorrelated({
      sentry_event_id: "evt_1",
      trace_id: "trace_1",
      request_id: "req_abc",
      route: "/chat",
      status_class: "5xx",
      release: "live.frapp.mobile@1.0.0+12",
      exception: "Error: secret",
      stack: "at treasurer@chapter.example.edu",
      message: "invite failed",
      body: '{"email":"x"}',
      query: "?token=abc",
    });
    const capture = memory.calls.find((c) => c.type === "capture");
    expect(capture).toEqual({
      type: "capture",
      event: SENTRY_ERROR_CORRELATED_EVENT,
      properties: {
        sentry_event_id: "evt_1",
        trace_id: "trace_1",
        request_id: "req_abc",
        route: "/chat",
        status_class: "5xx",
        release: "live.frapp.mobile@1.0.0+12",
      },
    });
    const json = JSON.stringify(capture);
    expect(json).not.toContain("secret");
    expect(json).not.toContain(EMAIL);
    expect(json).not.toContain("token=");
    expect(json).not.toContain("exception");
  });

  it("never captures $exception", () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    applyAnalyticsIdentity({
      enabled: true,
      distinct_id: HEX,
      chapter_group_id: null,
    });
    expect(
      memory.calls.some(
        (c) => c.type === "capture" && c.event.includes("exception"),
      ),
    ).toBe(false);
  });
});
