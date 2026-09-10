import { describe, expect, it } from "vitest";
import {
  POSTHOG_EXCEPTION_AUTOCAPTURE,
  POSTHOG_PRODUCTION_REPLAY_ENABLED,
} from "../src/policy";
import {
  POSTHOG_PROPERTY_DENYLIST,
  buildAnonymousPostHogBrowserOptions,
  sanitizeAnonymousPostHogCapture,
  sanitizeAnonymousPostHogProperties,
  sanitizeIdentifiedPostHogCapture,
  shouldEnablePostHogReplay,
} from "./posthog-options";

const HEX = "a".repeat(64);
const CHAPTER_HEX = "b".repeat(64);
const UUID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const JOIN_WITH_TOKEN =
  "https://app.frapp.live/join?token=invite-token-secret&email=treasurer@chapter.example.edu";

describe("replay decision", () => {
  it("cannot turn production replay on while the policy constant is false", () => {
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

describe("POSTHOG_PROPERTY_DENYLIST", () => {
  it("matches landing's IP and email roster", () => {
    expect(POSTHOG_PROPERTY_DENYLIST).toEqual(["$ip", "ip", "email", "$email"]);
  });
});

describe("sanitizeIdentifiedPostHogCapture", () => {
  it("path-only-reduces URLs, keeps hex groups and sanitized $set", () => {
    const out = sanitizeIdentifiedPostHogCapture({
      uuid: "evt",
      event: "$identify",
      properties: {
        $current_url: JOIN_WITH_TOKEN,
        $pathname: "/join?token=invite-token-secret",
        $referrer: "https://frapp.live/privacy?ref=abc",
        $ip: "203.0.113.9",
        email: "treasurer@chapter.example.edu",
        $groups: { chapter: CHAPTER_HEX, other: UUID },
        $set: { $initial_current_url: JOIN_WITH_TOKEN },
      },
      $set: {
        distinct_id: HEX,
        $initial_current_url: JOIN_WITH_TOKEN,
        email: "treasurer@chapter.example.edu",
      },
      $set_once: { $initial_current_url: JOIN_WITH_TOKEN },
    });
    expect(out?.properties).toEqual({
      $current_url: "/join",
      $pathname: "/join",
      $referrer: "/privacy",
      $groups: { chapter: CHAPTER_HEX },
      $set: { $initial_current_url: "/join" },
    });
    expect(out?.$set).toEqual({
      distinct_id: HEX,
      $initial_current_url: "/join",
    });
    expect(out?.$set_once).toEqual({ $initial_current_url: "/join" });
    const json = JSON.stringify(out);
    expect(json).not.toContain("invite-token-secret");
    expect(json).not.toContain("treasurer@chapter.example.edu");
    expect(json).not.toContain("203.0.113.9");
    expect(json).not.toContain(UUID);
    expect(json).not.toContain("?");
    expect(json).toContain(HEX);
    expect(json).toContain(CHAPTER_HEX);
  });

  it("drops $groups when no value is 64-hex", () => {
    const out = sanitizeIdentifiedPostHogCapture({
      event: "sentry-error-correlated",
      properties: { $groups: { chapter: UUID } },
    });
    expect(out?.properties).toEqual({});
  });

  it("returns null when the capture is null", () => {
    expect(sanitizeIdentifiedPostHogCapture(null)).toBeNull();
  });
});
