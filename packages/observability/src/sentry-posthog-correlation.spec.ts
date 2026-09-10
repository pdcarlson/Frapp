import { afterEach, describe, expect, it } from "vitest";
import { SENTRY_ERROR_CORRELATED_EVENT } from "./policy";
import {
  bindPostHogAdapterForTests,
  createMemoryPostHogAdapter,
} from "./posthog-adapter";
import {
  attachPostHogCorrelation,
  withPostHogSentryCorrelation,
} from "./sentry-posthog-correlation";

const HEX = "a".repeat(64);
const EMAIL = "treasurer@chapter.example.edu";
const UUID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

afterEach(() => {
  bindPostHogAdapterForTests(null);
});

describe("attachPostHogCorrelation", () => {
  it("attaches validated PostHog ids after scrub and emits the marker", () => {
    const memory = createMemoryPostHogAdapter();
    memory.setRecording(true);
    bindPostHogAdapterForTests(memory.adapter);
    memory.adapter.identify(HEX);

    const event = attachPostHogCorrelation({
      event_id: "sentry-evt",
      release: "abc123",
      transaction: "/v1/members",
      request: { headers: { "x-request-id": "req_from_sdk" } },
      contexts: {
        trace: { trace_id: "trace-abc" },
        response: { status_code: 500 },
      },
    });

    expect(event.tags?.posthog_distinct_id).toBe(HEX);
    expect(event.tags?.posthog_session_id).toBe("ph_session_test");
    expect(event.tags?.posthog_replay_id).toBe("ph_session_test");

    const capture = memory.calls.find((c) => c.type === "capture");
    expect(capture?.type === "capture" && capture.event).toBe(
      SENTRY_ERROR_CORRELATED_EVENT,
    );
    expect(capture && capture.type === "capture" && capture.properties).toEqual({
      sentry_event_id: "sentry-evt",
      trace_id: "trace-abc",
      request_id: "req_from_sdk",
      route: "/v1/members",
      status_class: "5xx",
      release: "abc123",
    });
    expect(JSON.stringify(capture)).not.toContain(EMAIL);
    expect(capture && capture.type === "capture" && capture.properties).not.toHaveProperty(
      "exception",
    );
    expect(event.tags?.posthog_distinct_id).not.toBe(UUID);
  });

  it("does not copy the Sentry trace id into request_id", () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    attachPostHogCorrelation({
      event_id: "e1",
      contexts: { trace: { trace_id: "trace-only" } },
    });
    const capture = memory.calls.find((c) => c.type === "capture");
    expect(
      capture && capture.type === "capture" && capture.properties?.request_id,
    ).toBeUndefined();
    expect(
      capture && capture.type === "capture" && capture.properties?.trace_id,
    ).toBe("trace-only");
  });
});

describe("withPostHogSentryCorrelation", () => {
  it("keeps status_class on the marker even though the scrubber drops contexts.response", async () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    const wrapped = withPostHogSentryCorrelation((event) => event);
    await wrapped(
      {
        event_id: "e2",
        contexts: { response: { status_code: 404 } },
      },
      {},
    );
    const capture = memory.calls.find((c) => c.type === "capture");
    expect(
      capture && capture.type === "capture" && capture.properties?.status_class,
    ).toBe("4xx");
  });

  it("runs after the scrubber so a dropped event is not marked", async () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    const wrapped = withPostHogSentryCorrelation(() => null);
    expect(await wrapped({}, {})).toBeNull();
    expect(memory.calls.some((c) => c.type === "capture")).toBe(false);
  });
});
