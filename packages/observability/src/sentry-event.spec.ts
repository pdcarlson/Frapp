import { describe, expect, it } from "vitest";
import { statusFrom, traceIdFrom } from "./sentry-event";

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
