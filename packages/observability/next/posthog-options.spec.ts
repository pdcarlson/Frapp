import { describe, expect, it } from "vitest";
import { POSTHOG_EXCEPTION_AUTOCAPTURE } from "../src/policy";
import {
  buildAnonymousPostHogBrowserOptions,
  sanitizeAnonymousPostHogCapture,
  sanitizeAnonymousPostHogProperties,
} from "./posthog-options";

describe("anonymous PostHog JS options", () => {
  it("disables exception autocapture, pageviews, and session recording", () => {
    const options = buildAnonymousPostHogBrowserOptions({
      apiHost: "https://us.i.posthog.com",
      environment: "preview",
    });
    expect(options.capture_exceptions).toBe(POSTHOG_EXCEPTION_AUTOCAPTURE);
    expect(options.capture_exceptions).toBe(false);
    expect(options.autocapture).toBe(false);
    expect(options.capture_pageview).toBe(false);
    expect(options.capture_pageleave).toBe(false);
    expect(options.capture_heatmaps).toBe(false);
    expect(options.disable_session_recording).toBe(true);
    expect(options.session_recording.maskAllInputs).toBe(true);
    expect(options.session_recording.maskTextSelector).toBe("*");
    expect(options.session_recording.blockClass).toBe("ph-no-capture");
    expect(options).not.toHaveProperty("person_profiles");
  });

  it("still disables recording when asked for production", () => {
    const options = buildAnonymousPostHogBrowserOptions({
      apiHost: "https://us.i.posthog.com",
      environment: "production",
    });
    expect(options.disable_session_recording).toBe(true);
  });
});

describe("sanitizeAnonymousPostHogProperties", () => {
  it("strips email, IP, tokens, query strings, and bodies", () => {
    const envelope = {
      event: "$pageview",
      properties: sanitizeAnonymousPostHogProperties({
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

  it("drops person $set payloads on capture sanitizer", () => {
    const out = sanitizeAnonymousPostHogCapture({
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
