import { afterEach, describe, expect, it, vi } from "vitest";
import { SENTRY_ERROR_CORRELATED_EVENT } from "@repo/observability";
import {
  bindPostHogAdapterForTests,
  captureLandingCta,
  captureLandingPageview,
  captureSentryErrorCorrelated,
  createMemoryPostHogAdapter,
  initLandingPostHog,
} from "./client";
import { LANDING_CTA_EVENT } from "./events";

const EMAIL = "treasurer@chapter.example.edu";
const ANON_UUID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

const posthogInit = vi.hoisted(() => vi.fn());

vi.mock("posthog-js", () => ({
  default: {
    init: posthogInit,
    capture: vi.fn(),
    get_session_id: () => "",
    get_distinct_id: () => "",
    sessionRecordingStarted: () => false,
  },
}));

afterEach(() => {
  bindPostHogAdapterForTests(null);
  vi.unstubAllEnvs();
  posthogInit.mockClear();
});

describe("initLandingPostHog", () => {
  it("is a no-op without a key and never opens a transport", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    initLandingPostHog();
    initLandingPostHog();
    expect(posthogInit).not.toHaveBeenCalled();
  });

  it("initializes exactly once when a key is present", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_write_only");
    vi.stubGlobal("window", {});
    initLandingPostHog();
    initLandingPostHog();
    expect(posthogInit).toHaveBeenCalledTimes(1);
    const options = posthogInit.mock.calls[0]?.[1] as {
      capture_exceptions?: boolean;
      disable_session_recording?: boolean;
      person_profiles?: string;
      cross_subdomain_cookie?: boolean;
    };
    expect(options.capture_exceptions).toBe(false);
    expect(options.disable_session_recording).toBe(true);
    expect(options.person_profiles).toBe("never");
    expect(options.cross_subdomain_cookie).toBe(false);
  });
});

describe("anonymous capture", () => {
  it("records path-only pageviews and drops query-bearing paths", () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);

    captureLandingPageview("/privacy");
    captureLandingPageview("/join?token=invite-token-secret");
    captureLandingPageview("/join#frag");

    expect(memory.calls).toEqual([
      {
        type: "capture",
        event: "$pageview",
        properties: { $pathname: "/privacy", $current_url: "/privacy" },
      },
    ]);
    expect(JSON.stringify(memory.calls)).not.toContain("token=");
  });

  it("records allowlisted CTA properties only, never href or email", () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);

    captureLandingCta("get-started", "header");
    captureLandingCta("not-a-cta", "header");
    captureLandingCta("log-in", "not-a-surface");

    expect(memory.calls).toEqual([
      {
        type: "capture",
        event: LANDING_CTA_EVENT,
        properties: { cta: "get-started", surface: "header" },
      },
    ]);
    expect(JSON.stringify(memory.calls)).not.toContain(EMAIL);
    expect(JSON.stringify(memory.calls)).not.toContain("href");
  });

  it("does not expose identify, alias, or group on the adapter", () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    expect(memory.adapter).not.toHaveProperty("identify");
    expect(memory.adapter).not.toHaveProperty("alias");
    expect(memory.adapter).not.toHaveProperty("group");
    expect(JSON.stringify(memory.calls)).not.toContain(ANON_UUID);
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
      route: "/",
      status_class: "5xx",
      release: "deadbeef",
      exception: "Error: secret",
      stack: `at ${EMAIL}`,
      message: "invite failed",
      body: `{"email":"${EMAIL}"}`,
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
        route: "/",
        status_class: "5xx",
        release: "deadbeef",
      },
    });
    const json = JSON.stringify(capture);
    expect(json).not.toContain("secret");
    expect(json).not.toContain(EMAIL);
    expect(json).not.toContain("token=");
  });
});
