import { afterEach, describe, expect, it } from "vitest";
import { SENTRY_ERROR_CORRELATED_EVENT } from "./policy";
import {
  applyAnalyticsIdentity,
  applyAnalyticsOptOut,
  applyObservabilityIdentity,
  bindPostHogAdapterForTests,
  captureSentryErrorCorrelated,
  createMemoryPostHogAdapter,
  getPostHogReplayId,
  isProductFlagEnabled,
  resetPostHog,
} from "./posthog-adapter";

const HEX = "a".repeat(64);
const OTHER = "b".repeat(64);
const UUID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const EMAIL = "treasurer@chapter.example.edu";

afterEach(() => {
  bindPostHogAdapterForTests(null);
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

  it("sets Sentry user from the same validated hex", () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    const setUser = (user: { id: string } | null) => {
      lastUser = user;
    };
    let lastUser: { id: string } | null | undefined;
    applyObservabilityIdentity(
      { enabled: true, distinct_id: HEX, chapter_group_id: null },
      setUser,
    );
    expect(lastUser).toEqual({ id: HEX });
    applyObservabilityIdentity(
      { enabled: true, distinct_id: EMAIL, chapter_group_id: HEX },
      setUser,
    );
    expect(lastUser).toBeNull();
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
      release: "deadbeef",
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
        release: "deadbeef",
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
