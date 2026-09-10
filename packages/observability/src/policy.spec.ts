import { describe, expect, it } from "vitest";
import {
  BAGGAGE_HEADER,
  PSEUDONYM_HEX_RE,
  REQUEST_ID_HEADER,
  SENTRY_TRACE_HEADER,
  isPseudonymHex,
} from "./correlation";
import {
  DEFAULT_POSTHOG_LOGS_SAMPLE_RATE,
  OBSERVABILITY_PROVIDERS,
  POSTHOG_EXCEPTION_AUTOCAPTURE,
  POSTHOG_PRODUCTION_REPLAY_ENABLED,
  shouldEnablePostHogReplay,
  SENTRY_ERROR_CORRELATED_EVENT,
  SENTRY_ERROR_SAMPLE_RATE,
  SENTRY_REPLAY_ENABLED,
} from "./policy";
import { DEFAULT_TRACES_SAMPLE_RATE } from "./sample-rate";

describe("isPseudonymHex", () => {
  it("accepts a 64-character lowercase hex digest and nothing else", () => {
    expect(isPseudonymHex("a".repeat(64))).toBe(true);
    expect(isPseudonymHex("A".repeat(64))).toBe(false);
    expect(isPseudonymHex("3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b")).toBe(false);
    expect(isPseudonymHex("not-a-hash")).toBe(false);
    expect(isPseudonymHex(undefined)).toBe(false);
    expect(PSEUDONYM_HEX_RE.test("a".repeat(64))).toBe(true);
  });
});

describe("correlation constants", () => {
  it("names the request-id header distinctly from trace ids", () => {
    expect(REQUEST_ID_HEADER).toBe("x-request-id");
    expect(SENTRY_TRACE_HEADER).toBe("sentry-trace");
    expect(BAGGAGE_HEADER).toBe("baggage");
    expect(REQUEST_ID_HEADER).not.toBe(SENTRY_TRACE_HEADER);
    expect(REQUEST_ID_HEADER).not.toBe(BAGGAGE_HEADER);
  });
});

describe("policy constants", () => {
  it("keeps errors counted only in Sentry and replay off", () => {
    expect(OBSERVABILITY_PROVIDERS.exceptions).toBe("sentry");
    expect(OBSERVABILITY_PROVIDERS.traces).toBe("sentry");
    expect(OBSERVABILITY_PROVIDERS.productAnalytics).toBe("posthog");
    expect(OBSERVABILITY_PROVIDERS.replay).toBe("posthog");
    expect(SENTRY_REPLAY_ENABLED).toBe(false);
    expect(POSTHOG_EXCEPTION_AUTOCAPTURE).toBe(false);
    expect(POSTHOG_PRODUCTION_REPLAY_ENABLED).toBe(false);
    expect(SENTRY_ERROR_SAMPLE_RATE).toBe(1);
    expect(SENTRY_ERROR_CORRELATED_EVENT).toBe("sentry-error-correlated");
    expect(DEFAULT_POSTHOG_LOGS_SAMPLE_RATE).toBe(1);
    expect(DEFAULT_TRACES_SAMPLE_RATE).toBe(0.1);
  });

  it("cannot turn production replay on while the policy constant is false", () => {
    expect(POSTHOG_PRODUCTION_REPLAY_ENABLED).toBe(false);
    expect(shouldEnablePostHogReplay({ environment: "production" })).toBe(
      false,
    );
    expect(shouldEnablePostHogReplay({ environment: "preview" })).toBe(false);
    expect(shouldEnablePostHogReplay({ environment: "development" })).toBe(
      false,
    );
  });
});
