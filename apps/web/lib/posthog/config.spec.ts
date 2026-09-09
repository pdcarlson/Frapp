import { afterEach, describe, expect, it, vi } from "vitest";
import {
  POSTHOG_EXCEPTION_AUTOCAPTURE,
  POSTHOG_PRODUCTION_REPLAY_ENABLED,
} from "@repo/observability";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load() {
  return import("./config");
}

describe("PostHog JS credentials", () => {
  it("is unconfigured when the write-only key is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    const { isPostHogConfigured, webPostHogKey } = await load();
    expect(webPostHogKey()).toBeUndefined();
    expect(isPostHogConfigured()).toBe(false);
  });

  it("reads the host from env and defaults to US Cloud", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "");
    const { webPostHogHost } = await load();
    expect(webPostHogHost()).toBe("https://us.i.posthog.com");
  });
});

describe("replay decision", () => {
  it("cannot turn production replay on while the policy constant is false", async () => {
    const { shouldEnablePostHogReplay } = await load();
    expect(POSTHOG_PRODUCTION_REPLAY_ENABLED).toBe(false);
    expect(shouldEnablePostHogReplay({ environment: "production" })).toBe(
      false,
    );
    expect(shouldEnablePostHogReplay({ environment: "preview" })).toBe(false);
    expect(shouldEnablePostHogReplay({ environment: "development" })).toBe(
      false,
    );
  });
});

describe("init options the app ships", () => {
  it("disables exception autocapture, pageviews, and session recording", async () => {
    const { buildWebPostHogInitOptions } = await load();
    const options = buildWebPostHogInitOptions({ environment: "preview" });
    expect(options.capture_exceptions).toBe(POSTHOG_EXCEPTION_AUTOCAPTURE);
    expect(options.capture_exceptions).toBe(false);
    expect(options.autocapture).toBe(false);
    expect(options.capture_pageview).toBe(false);
    expect(options.capture_pageleave).toBe(false);
    expect(options.capture_heatmaps).toBe(false);
    expect(options.disable_session_recording).toBe(true);
    expect(options.person_profiles).toBe("identified_only");
    expect(options.session_recording?.maskAllInputs).toBe(true);
    expect(options.session_recording?.maskTextSelector).toBe("*");
    expect(options.session_recording?.blockClass).toBe("ph-no-capture");
  });

  it("still disables recording when asked for production", async () => {
    const { buildWebPostHogInitOptions } = await load();
    const options = buildWebPostHogInitOptions({ environment: "production" });
    expect(options.disable_session_recording).toBe(true);
  });
});
