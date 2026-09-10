import { afterEach, describe, expect, it } from "vitest";
import { SENTRY_ERROR_CORRELATED_EVENT } from "@repo/observability";
import {
  bindPostHogAdapterForTests,
  createMemoryPostHogAdapter,
} from "../posthog/client";
import {
  attachPostHogCorrelation,
  withPostHogSentryCorrelation,
} from "./correlation";

const EMAIL = "treasurer@chapter.example.edu";
const ANON_UUID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

afterEach(() => {
  bindPostHogAdapterForTests(null);
});

describe("attachPostHogCorrelation", () => {
  it("attaches session/replay tags, never the anonymous distinct id or user", () => {
    const memory = createMemoryPostHogAdapter();
    memory.setRecording(true);
    memory.setDistinctId(ANON_UUID);
    bindPostHogAdapterForTests(memory.adapter);

    const event = attachPostHogCorrelation({
      event_id: "sentry-evt",
      release: "abc123",
      transaction: "/",
      user: { id: ANON_UUID, email: EMAIL },
      request: { headers: { "x-request-id": "req_from_sdk" } },
      contexts: {
        trace: { trace_id: "trace-abc" },
        response: { status_code: 500 },
      },
      exception: { values: [{ type: "Error", value: `fail ${EMAIL}` }] },
    } as never);

    expect(event.user).toBeUndefined();
    expect(event.tags?.posthog_distinct_id).toBeUndefined();
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
      route: "/",
      status_class: "5xx",
      release: "abc123",
    });
    expect(JSON.stringify(capture)).not.toContain(EMAIL);
    expect(JSON.stringify(event.tags)).not.toContain(ANON_UUID);
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
      } as never,
      {} as never,
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
    expect(await wrapped({} as never, {} as never)).toBeNull();
    expect(memory.calls.some((c) => c.type === "capture")).toBe(false);
  });
});
