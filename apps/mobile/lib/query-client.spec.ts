import { describe, expect, it } from "vitest";
import { queryRetryDelay, retryQuery } from "./query-client";

/**
 * A busy server's 429 (Cloud Run's `Rate exceeded.` when every copy of the
 * API is full) is retried quietly for about a minute and a half, so a short
 * overload reads as loading rather than as "Couldn't load" (staging,
 * 2026-11-20). Everything else keeps the one retry it had.
 */
describe("query retry", () => {
  const busy = { statusCode: 429, message: "Rate exceeded." };

  it("keeps retrying a busy server's 429 six times", () => {
    expect([0, 1, 2, 3, 4, 5].every((n) => retryQuery(n, busy))).toBe(true);
    expect(retryQuery(6, busy)).toBe(false);
  });

  it("waits longer between a busy server's retries", () => {
    expect([0, 1, 2, 3, 4, 5].map((n) => queryRetryDelay(n, busy))).toEqual([
      2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });

  it("gives anything else, the throttler's 429 included, one retry", () => {
    const throttled = {
      statusCode: 429,
      message: "Too many requests in a short time. Wait a minute, then try again.",
      requestId: "r",
    };
    for (const error of [throttled, { statusCode: 500 }, new TypeError("x")]) {
      expect(retryQuery(0, error)).toBe(true);
      expect(retryQuery(1, error)).toBe(false);
    }
    expect(queryRetryDelay(0, { statusCode: 500 })).toBe(1000);
  });
});
