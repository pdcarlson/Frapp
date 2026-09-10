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
    const { isPostHogConfigured, landingPostHogKey } = await load();
    expect(landingPostHogKey()).toBeUndefined();
    expect(isPostHogConfigured()).toBe(false);
  });

  it("reads the host from env and defaults to US Cloud", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "");
    const { landingPostHogHost } = await load();
    expect(landingPostHogHost()).toBe("https://us.i.posthog.com");
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
  it("disables exception autocapture, default pageviews, flags, and session recording", async () => {
    const { buildLandingPostHogInitOptions } = await load();
    const options = buildLandingPostHogInitOptions({ environment: "preview" });
    expect(options.capture_exceptions).toBe(POSTHOG_EXCEPTION_AUTOCAPTURE);
    expect(options.capture_exceptions).toBe(false);
    expect(options.autocapture).toBe(false);
    expect(options.capture_pageview).toBe(false);
    expect(options.capture_pageleave).toBe(false);
    expect(options.capture_heatmaps).toBe(false);
    expect(options.disable_session_recording).toBe(true);
    expect(options.person_profiles).toBe("never");
    expect(options.cross_subdomain_cookie).toBe(false);
    expect(options.advanced_disable_feature_flags).toBe(true);
    expect(options.session_recording?.maskAllInputs).toBe(true);
    expect(options.session_recording?.maskTextSelector).toBe("*");
    expect(options.session_recording?.blockClass).toBe("ph-no-capture");
    expect(typeof options.before_send).toBe("function");
  });

  it("still disables recording when asked for production", async () => {
    const { buildLandingPostHogInitOptions } = await load();
    const options = buildLandingPostHogInitOptions({
      environment: "production",
    });
    expect(options.disable_session_recording).toBe(true);
  });
});

describe("sanitizeLandingPostHogProperties", () => {
  it("strips email, IP, tokens, query strings, and bodies from the exact payload", async () => {
    const { sanitizeLandingPostHogProperties } = await load();
    const envelope = {
      event: "$pageview",
      properties: sanitizeLandingPostHogProperties({
        $current_url:
          "https://frapp.live/join?token=invite-token-secret&email=treasurer@chapter.example.edu",
        $pathname: "/join?token=invite-token-secret",
        $ip: "203.0.113.9",
        ip: "203.0.113.9",
        email: "treasurer@chapter.example.edu",
        $email: "treasurer@chapter.example.edu",
        $set: { email: "treasurer@chapter.example.edu" },
        body: { token: "invite-token-secret" },
        note: "contact treasurer@chapter.example.edu",
      }),
    };

    expect(envelope).toEqual({
      event: "$pageview",
      properties: {
        $current_url: "/join",
        $pathname: "/join",
      },
    });
    const json = JSON.stringify(envelope);
    expect(json).not.toContain("treasurer@chapter.example.edu");
    expect(json).not.toContain("invite-token-secret");
    expect(json).not.toContain("203.0.113.9");
    expect(json).not.toContain("?");
  });

  it("drops person $set payloads on before_send", async () => {
    const { sanitizeLandingCapture } = await load();
    const out = sanitizeLandingCapture({
      uuid: "evt",
      event: "$pageview",
      properties: {
        $current_url: "https://frapp.live/privacy?ref=abc",
        $ip: "203.0.113.9",
      },
      $set: { email: "treasurer@chapter.example.edu" },
      $set_once: { email: "treasurer@chapter.example.edu" },
    });
    expect(out?.$set).toBeUndefined();
    expect(out?.$set_once).toBeUndefined();
    expect(out?.properties).toEqual({ $current_url: "/privacy" });
    expect(JSON.stringify(out)).not.toContain("treasurer@chapter.example.edu");
    expect(JSON.stringify(out)).not.toContain("?");
  });
});
