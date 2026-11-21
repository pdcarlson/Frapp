import { describe, expect, it } from "vitest";
import { queryClient, retryQuery } from "./query-client";

/**
 * A busy server's 429 (Cloud Run's `Rate exceeded.` when every copy of the
 * API is full) is retried quietly for up to about a minute and a half, so a
 * short overload reads as loading rather than as "Couldn't load" (staging,
 * 2026-11-20). Everything else keeps the one retry it had. Read off the
 * product client's own defaults, so dropping them from it fails here.
 */
describe("query retry", () => {
  const defaults = queryClient.getDefaultOptions().queries!;
  const retry = defaults.retry as (count: number, error: unknown) => boolean;
  const retryDelay = defaults.retryDelay as (
    attempt: number,
    error: unknown,
  ) => number;
  const busy = { statusCode: 429, message: "Rate exceeded." };

  it("is the client's default", () => {
    expect(retry).toBe(retryQuery);
  });

  it("keeps retrying a busy server's 429 six times", () => {
    expect([0, 1, 2, 3, 4, 5].every((n) => retry(n, busy))).toBe(true);
    expect(retry(6, busy)).toBe(false);
  });

  it("waits longer, jittered, between a busy server's retries", () => {
    const first = retryDelay(0, busy);
    expect(first).toBeGreaterThanOrEqual(1000);
    expect(first).toBeLessThanOrEqual(2000);
    expect(retryDelay(5, busy)).toBeGreaterThanOrEqual(15_000);
  });

  it("gives anything else, the throttler's 429 included, one retry", () => {
    const throttled = {
      statusCode: 429,
      message: "Too many requests in a short time. Wait a minute, then try again.",
      requestId: "r",
    };
    for (const error of [throttled, { statusCode: 500 }, new TypeError("x")]) {
      expect(retry(0, error)).toBe(true);
      expect(retry(1, error)).toBe(false);
    }
    expect(retryDelay(0, { statusCode: 500 })).toBe(1000);
  });
});
