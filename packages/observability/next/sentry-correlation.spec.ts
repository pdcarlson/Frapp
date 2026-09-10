import { describe, expect, it } from "vitest";
import { SENTRY_ERROR_CORRELATED_EVENT } from "../src/policy";
import {
  attachAnonymousPostHogCorrelation,
  withAnonymousPostHogSentryCorrelation,
} from "./sentry-correlation";

const EMAIL = "treasurer@chapter.example.edu";
const ANON_UUID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

function memorySource() {
  const calls: { event: string; properties?: Record<string, unknown> }[] = [];
  return {
    calls,
    source: {
      getSessionId: () => "ph_session_test",
      getReplayId: () => "ph_session_test",
      captureSentryErrorCorrelated(properties: Record<string, unknown>) {
        calls.push({
          event: SENTRY_ERROR_CORRELATED_EVENT,
          properties,
        });
      },
    },
  };
}

describe("attachAnonymousPostHogCorrelation", () => {
  it("attaches session/replay tags and the marker, never a distinct id", () => {
    const { calls, source } = memorySource();
    const event = attachAnonymousPostHogCorrelation(
      {
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
      },
      source,
    );

    expect(event.user).toEqual({ id: ANON_UUID, email: EMAIL });
    expect(event.tags?.posthog_distinct_id).toBeUndefined();
    expect(event.tags?.posthog_session_id).toBe("ph_session_test");
    expect(event.tags?.posthog_replay_id).toBe("ph_session_test");
    expect(calls).toEqual([
      {
        event: SENTRY_ERROR_CORRELATED_EVENT,
        properties: {
          sentry_event_id: "sentry-evt",
          trace_id: "trace-abc",
          request_id: "req_from_sdk",
          route: "/",
          status_class: "5xx",
          release: "abc123",
        },
      },
    ]);
    expect(JSON.stringify(calls)).not.toContain(EMAIL);
    expect(JSON.stringify(event.tags)).not.toContain(ANON_UUID);
  });

  it("does not copy the Sentry trace id into request_id", () => {
    const { calls, source } = memorySource();
    attachAnonymousPostHogCorrelation(
      {
        event_id: "e1",
        contexts: { trace: { trace_id: "trace-only" } },
      },
      source,
    );
    expect(calls[0]?.properties?.request_id).toBeUndefined();
    expect(calls[0]?.properties?.trace_id).toBe("trace-only");
  });
});

describe("withAnonymousPostHogSentryCorrelation", () => {
  it("keeps status_class on the marker even though the scrubber drops contexts.response", async () => {
    const { calls, source } = memorySource();
    const wrapped = withAnonymousPostHogSentryCorrelation(
      (event) => event,
      (event, extras) =>
        attachAnonymousPostHogCorrelation(event, source, extras),
    );
    await wrapped(
      {
        event_id: "e2",
        contexts: { response: { status_code: 404 } },
      },
      {},
    );
    expect(calls[0]?.properties?.status_class).toBe("4xx");
  });

  it("runs after the scrubber so a dropped event is not marked", async () => {
    const { calls, source } = memorySource();
    const wrapped = withAnonymousPostHogSentryCorrelation(
      () => null,
      (event, extras) =>
        attachAnonymousPostHogCorrelation(event, source, extras),
    );
    expect(await wrapped({} as never, {})).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
