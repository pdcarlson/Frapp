import { describe, expect, it } from "vitest";
import {
  afterScrubber,
  sentryMarkerFrom,
  statusFrom,
  traceIdFrom,
} from "./sentry-event";

describe("traceIdFrom", () => {
  it("reads a non-empty string trace id", () => {
    expect(traceIdFrom({ contexts: { trace: { trace_id: "abc123" } } })).toBe(
      "abc123",
    );
  });

  it("returns undefined for a missing, empty, or non-string trace id", () => {
    expect(traceIdFrom({})).toBeUndefined();
    expect(traceIdFrom({ contexts: {} })).toBeUndefined();
    expect(traceIdFrom({ contexts: { trace: "abc123" } })).toBeUndefined();
    expect(traceIdFrom({ contexts: { trace: {} } })).toBeUndefined();
    expect(
      traceIdFrom({ contexts: { trace: { trace_id: "" } } }),
    ).toBeUndefined();
    expect(
      traceIdFrom({ contexts: { trace: { trace_id: 42 } } }),
    ).toBeUndefined();
  });
});

describe("statusFrom", () => {
  it("prefers the response context over the tag", () => {
    expect(
      statusFrom({
        contexts: { response: { status_code: 503 } },
        tags: { "http.status_code": 200 },
      }),
    ).toBe(503);
  });

  it("does not fall back to the tag when the response context has no status", () => {
    expect(
      statusFrom({
        contexts: { response: {} },
        tags: { "http.status_code": 200 },
      }),
    ).toBeUndefined();
  });

  it("reads a numeric tag and coerces a string tag", () => {
    expect(statusFrom({ tags: { "http.status_code": 404 } })).toBe(404);
    expect(statusFrom({ tags: { "http.status_code": "404" } })).toBe(404);
  });

  it("returns undefined with no response context and no usable tag", () => {
    expect(statusFrom({})).toBeUndefined();
    expect(statusFrom({ tags: { "http.status_code": true } })).toBeUndefined();
  });
});

describe("sentryMarkerFrom", () => {
  it("reads every marker field off the event", () => {
    expect(
      sentryMarkerFrom({
        event_id: "e1",
        transaction: "/chapters/[id]",
        release: "r1",
        request: { headers: { "x-request-id": "req-1" } },
        contexts: {
          trace: { trace_id: "t1" },
          response: { status_code: 503 },
        },
      }),
    ).toEqual({
      sentry_event_id: "e1",
      trace_id: "t1",
      request_id: "req-1",
      route: "/chapters/[id]",
      status_class: "5xx",
      release: "r1",
    });
  });

  it("drops a non-string route and release, and prefers an explicit status class", () => {
    const marker = sentryMarkerFrom(
      {
        transaction: 1,
        release: {},
        contexts: { response: { status_code: 200 } },
      },
      { statusClass: "4xx" },
    );
    expect(marker.route).toBeUndefined();
    expect(marker.release).toBeUndefined();
    expect(marker.status_class).toBe("4xx");
  });
});

describe("afterScrubber", () => {
  type Ev = { id: string; contexts?: { response?: { status_code?: number } } };

  it("reads the status class before the scrubber drops contexts.response", async () => {
    const seen: Array<string | undefined> = [];
    const wrapped = afterScrubber<Ev, unknown>(
      ({ id }) => ({ id }),
      (event, extras) => {
        seen.push(extras.statusClass);
        return event;
      },
    );
    await wrapped(
      { id: "a", contexts: { response: { status_code: 404 } } },
      {},
    );
    expect(seen).toEqual(["4xx"]);
  });

  it("attaches to the scrubbed event, and passes through with no scrubber", async () => {
    const attached: Ev[] = [];
    const attach = (event: Ev) => {
      attached.push(event);
      return event;
    };
    await afterScrubber<Ev, unknown>(() => ({ id: "scrubbed" }), attach)(
      { id: "raw" },
      {},
    );
    await afterScrubber<Ev, unknown>(undefined, attach)({ id: "raw" }, {});
    expect(attached.map((e) => e.id)).toEqual(["scrubbed", "raw"]);
  });

  it("does not attach when the scrubber drops the event", async () => {
    let calls = 0;
    const wrapped = afterScrubber<Ev, unknown>(
      () => null,
      (event) => {
        calls += 1;
        return event;
      },
    );
    expect(await wrapped({ id: "a" }, {})).toBeNull();
    expect(calls).toBe(0);
  });
});
