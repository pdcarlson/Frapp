import { describe, expect, it } from "vitest";
import { headerValue, httpStatusClass } from "./sentry-http";

describe("httpStatusClass", () => {
  it("buckets 2xx / 4xx / 5xx", () => {
    expect(httpStatusClass(200)).toBe("2xx");
    expect(httpStatusClass(201)).toBe("2xx");
    expect(httpStatusClass(404)).toBe("4xx");
    expect(httpStatusClass(500)).toBe("5xx");
    expect(httpStatusClass(503)).toBe("5xx");
  });

  it("buckets 1xx and 3xx rather than dropping them", () => {
    expect(httpStatusClass(100)).toBe("1xx");
    expect(httpStatusClass(101)).toBe("1xx");
    expect(httpStatusClass(304)).toBe("3xx");
  });

  it("buckets both ends of the valid range", () => {
    expect(httpStatusClass(199)).toBe("1xx");
    expect(httpStatusClass(599)).toBe("5xx");
  });

  it("omits a non-finite status instead of calling it a server error", () => {
    expect(httpStatusClass(Number.NaN)).toBeUndefined();
    expect(httpStatusClass(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(httpStatusClass(Number.NEGATIVE_INFINITY)).toBeUndefined();
  });

  it("omits a non-number", () => {
    expect(httpStatusClass(undefined)).toBeUndefined();
    expect(httpStatusClass(null)).toBeUndefined();
    expect(httpStatusClass("404")).toBeUndefined();
    expect(httpStatusClass({ status: 404 })).toBeUndefined();
  });

  it("omits a status outside 100–599", () => {
    expect(httpStatusClass(0)).toBeUndefined();
    expect(httpStatusClass(99)).toBeUndefined();
    expect(httpStatusClass(600)).toBeUndefined();
    expect(httpStatusClass(999)).toBeUndefined();
    expect(httpStatusClass(-500)).toBeUndefined();
  });

  it("omits a non-integer", () => {
    expect(httpStatusClass(404.5)).toBeUndefined();
  });
});

describe("headerValue", () => {
  it("reads a non-empty string header by its exact name", () => {
    expect(headerValue({ "X-Request-Id": "req_1" }, "X-Request-Id")).toBe(
      "req_1",
    );
  });

  it("falls back to the lowercase name when the exact name is absent", () => {
    expect(headerValue({ "x-request-id": "req_1" }, "X-Request-Id")).toBe(
      "req_1",
    );
  });

  it("is undefined for missing, empty or non-string values", () => {
    expect(headerValue({}, "x-request-id")).toBeUndefined();
    expect(headerValue({ "x-request-id": "" }, "x-request-id")).toBeUndefined();
    expect(
      headerValue({ "x-request-id": ["req_1"] }, "x-request-id"),
    ).toBeUndefined();
    expect(headerValue({ "x-request-id": 7 }, "x-request-id")).toBeUndefined();
  });

  it("is undefined when there is no headers object", () => {
    expect(headerValue(undefined, "x-request-id")).toBeUndefined();
    expect(headerValue(null, "x-request-id")).toBeUndefined();
    expect(headerValue("x-request-id: req_1", "x-request-id")).toBeUndefined();
  });
});
