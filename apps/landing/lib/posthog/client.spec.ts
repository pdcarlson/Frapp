import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindPostHogAdapterForTests,
  createMemoryPostHogAdapter,
} from "@repo/observability";
import { captureLandingCta, captureLandingPageview, initLandingPostHog } from "./client";
import { LANDING_CTA_EVENT } from "./events";

const posthogInit = vi.hoisted(() => vi.fn());
const posthogIdentify = vi.hoisted(() => vi.fn());
const posthogGroup = vi.hoisted(() => vi.fn());
const posthogAlias = vi.hoisted(() => vi.fn());

vi.mock("posthog-js", () => ({
  default: {
    init: posthogInit,
    capture: vi.fn(),
    identify: posthogIdentify,
    group: posthogGroup,
    alias: posthogAlias,
    get_session_id: () => "",
    get_distinct_id: () => "",
    sessionRecordingStarted: () => false,
    stopSessionRecording: vi.fn(),
  },
}));

afterEach(() => {
  bindPostHogAdapterForTests(null);
  vi.unstubAllEnvs();
  posthogInit.mockClear();
  posthogIdentify.mockClear();
  posthogGroup.mockClear();
  posthogAlias.mockClear();
});

describe("initLandingPostHog", () => {
  it("skips construction when the write-only key is blank", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    initLandingPostHog();
    initLandingPostHog();
    expect(posthogInit).not.toHaveBeenCalled();
  });

  it("constructs the JS SDK once and never aliases the visitor", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_write_only");
    vi.stubGlobal("window", {});
    initLandingPostHog();
    initLandingPostHog();
    expect(posthogInit).toHaveBeenCalledTimes(1);
    expect(posthogIdentify).not.toHaveBeenCalled();
    expect(posthogGroup).not.toHaveBeenCalled();
    expect(posthogAlias).not.toHaveBeenCalled();
    const shipped = posthogInit.mock.calls[0]?.[1] as {
      person_profiles?: string;
      cross_subdomain_cookie?: boolean;
      capture_exceptions?: boolean;
      disable_session_recording?: boolean;
    };
    expect(shipped.person_profiles).toBe("never");
    expect(shipped.cross_subdomain_cookie).toBe(false);
    expect(shipped.capture_exceptions).toBe(false);
    expect(shipped.disable_session_recording).toBe(true);
  });
});

describe("landing-only captures", () => {
  it("keeps $pageview path-only and drops query or fragment hrefs", () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);

    captureLandingPageview("/privacy");
    captureLandingPageview("/join?token=invite-token-secret");
    captureLandingPageview("/join#frag");

    const pageviews = memory.calls.filter((c) => c.type === "capture");
    expect(pageviews).toHaveLength(1);
    expect(pageviews[0]).toMatchObject({
      event: "$pageview",
      properties: { $pathname: "/privacy", $current_url: "/privacy" },
    });
    expect(JSON.stringify(pageviews)).not.toContain("token=");
  });

  it("accepts only the CTA allowlist", () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);

    captureLandingCta("get-started", "header");
    captureLandingCta("not-a-cta", "header");
    captureLandingCta("log-in", "not-a-surface");

    expect(memory.calls.filter((c) => c.type === "capture")).toEqual([
      {
        type: "capture",
        event: LANDING_CTA_EVENT,
        properties: { cta: "get-started", surface: "header" },
      },
    ]);
  });
});
