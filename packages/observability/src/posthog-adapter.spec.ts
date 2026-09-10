import { afterEach, describe, expect, it, vi } from "vitest";
import { SENTRY_ERROR_CORRELATED_EVENT } from "./policy";
import {
  applyAnalyticsIdentity,
  applyAnalyticsOptOut,
  applyFetchedObservabilityIdentity,
  applyObservabilityIdentity,
  namedAnalyticsEventBody,
  bindPostHogAdapterForTests,
  captureSentryErrorCorrelated,
  createMemoryPostHogAdapter,
  getPostHogReplayId,
  isProductFlagEnabled,
  resetPostHog,
  type NamedAnalyticsEventBody,
} from "./posthog-adapter";

/** Structural clone of `TrackEventDto` so a `unknown` properties map fails here. */
function asTrackEventDto(body: NamedAnalyticsEventBody): {
  name: string;
  chapter_id?: string;
  properties?: { [key: string]: (string | number | boolean) | null };
} {
  return body;
}

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
      { type: "reloadFeatureFlags" },
    ]);

    applyAnalyticsIdentity({
      enabled: true,
      distinct_id: HEX,
      chapter_group_id: null,
    });
    expect(memory.calls.slice(-2)).toEqual([
      { type: "resetGroups" },
      { type: "reloadFeatureFlags" },
    ]);

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

  it("clears a prior identify while the next subject's query is loading", () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    applyObservabilityIdentity(
      { enabled: true, distinct_id: HEX, chapter_group_id: null },
      () => undefined,
    );
    const setUser = vi.fn();
    applyFetchedObservabilityIdentity(true, undefined, setUser);
    expect(setUser).toHaveBeenCalledWith(null);
    expect(memory.calls.at(-1)).toEqual({ type: "reset" });
    expect(memory.adapter.getDistinctId()).toBeUndefined();
    applyFetchedObservabilityIdentity(false, null, setUser);
    expect(setUser).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "enabled: false",
      payload: {
        enabled: false,
        distinct_id: HEX,
        chapter_group_id: null,
      } as const,
    },
    { label: "null", payload: null },
    {
      label: "UUID",
      payload: {
        enabled: true,
        distinct_id: UUID,
        chapter_group_id: HEX,
      } as const,
    },
    {
      label: "email",
      payload: {
        enabled: true,
        distinct_id: EMAIL,
        chapter_group_id: HEX,
      } as const,
    },
  ])(
    "clears a prior identify when the next payload is $label",
    ({ payload }) => {
      const memory = createMemoryPostHogAdapter();
      bindPostHogAdapterForTests(memory.adapter);
      applyAnalyticsIdentity({
        enabled: true,
        distinct_id: HEX,
        chapter_group_id: OTHER,
      });
      expect(memory.adapter.getDistinctId()).toBe(HEX);

      applyAnalyticsIdentity(payload);

      expect(memory.adapter.getDistinctId()).toBeUndefined();
      expect(
        memory.calls.filter((c) => c.type === "identify").map((c) =>
          c.type === "identify" ? c.distinctId : "",
        ),
      ).toEqual([HEX]);
      expect(JSON.stringify(memory.calls)).not.toContain(UUID);
      expect(JSON.stringify(memory.calls)).not.toContain(EMAIL);
    },
  );
});

describe("namedAnalyticsEventBody", () => {
  it("omits chapter and properties when they are absent", () => {
    expect(
      asTrackEventDto(namedAnalyticsEventBody({ name: "opened-channel" })!),
    ).toEqual({
      name: "opened-channel",
    });
  });

  it("types properties as SDK scalar values, not unknown", () => {
    const body = namedAnalyticsEventBody({
      name: "opened-channel",
      properties: { minutes: 60, opted_in: true, note: null },
    });
    const properties: { [key: string]: string | number | boolean | null } =
      body?.properties ?? {};
    expect(properties).toEqual({ minutes: 60, opted_in: true, note: null });
  });

  it("requires a chapter when asked, then includes it", () => {
    expect(
      namedAnalyticsEventBody({
        name: "logged-hours",
        requireChapter: true,
      }),
    ).toBeNull();
    expect(
      namedAnalyticsEventBody({
        name: "logged-hours",
        chapterId: "chap-1",
        properties: { minutes: 60 },
        requireChapter: true,
      }),
    ).toEqual({
      name: "logged-hours",
      chapter_id: "chap-1",
      properties: { minutes: 60 },
    });
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

describe("isProductFlagEnabled", () => {
  it("fails closed until identify settles a hex distinct id, then reloads flags", () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    const vendorEnabled = vi.fn(() => true);
    memory.adapter.isFeatureEnabled = vendorEnabled;
    const readDistinctId = memory.adapter.getDistinctId.bind(memory.adapter);

    expect(isProductFlagEnabled("new-composer")).toBe(false);
    expect(vendorEnabled).not.toHaveBeenCalled();

    memory.adapter.getDistinctId = () => UUID;
    expect(isProductFlagEnabled("new-composer")).toBe(false);
    expect(vendorEnabled).not.toHaveBeenCalled();

    memory.adapter.getDistinctId = () => EMAIL;
    expect(isProductFlagEnabled("new-composer")).toBe(false);
    expect(vendorEnabled).not.toHaveBeenCalled();

    memory.adapter.getDistinctId = readDistinctId;
    applyAnalyticsIdentity({
      enabled: true,
      distinct_id: HEX,
      chapter_group_id: OTHER,
    });
    expect(memory.calls).toEqual([
      { type: "identify", distinctId: HEX },
      { type: "group", groupType: "chapter", groupKey: OTHER },
      { type: "reloadFeatureFlags" },
    ]);
    expect(JSON.stringify(memory.calls)).not.toContain(EMAIL);
    expect(isProductFlagEnabled("new-composer")).toBe(true);
    expect(vendorEnabled).toHaveBeenCalledWith("new-composer");

    applyAnalyticsIdentity({
      enabled: true,
      distinct_id: UUID,
      chapter_group_id: HEX,
    });
    vendorEnabled.mockClear();
    expect(isProductFlagEnabled("new-composer")).toBe(false);
    expect(vendorEnabled).not.toHaveBeenCalled();
  });

  it("fails closed for a missing adapter, opt-out, and a vendor miss after hex identify", () => {
    expect(isProductFlagEnabled("new-composer")).toBe(false);

    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    applyAnalyticsIdentity({
      enabled: true,
      distinct_id: HEX,
      chapter_group_id: null,
    });
    expect(memory.calls.at(-1)).toEqual({ type: "reloadFeatureFlags" });
    expect(isProductFlagEnabled("new-composer")).toBe(false);

    memory.adapter.isFeatureEnabled = () => true;
    applyAnalyticsOptOut(true);
    expect(isProductFlagEnabled("new-composer")).toBe(false);
  });
});
