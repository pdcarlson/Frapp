import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRACES_SAMPLE_RATE,
  NO_PSEUDONYMS,
  POSTHOG_EXCEPTION_AUTOCAPTURE,
  BAGGAGE_HEADER,
  REQUEST_ID_HEADER,
  SENTRY_TRACE_HEADER,
  SENTRY_REPLAY_ENABLED,
  createSentryScrubber,
  parseSampleRate,
  stripAuthority,
} from "./index";

describe("public API", () => {
  it("exports the scrubber, parser, and policy constants from the barrel", () => {
    expect(typeof createSentryScrubber).toBe("function");
    expect(typeof parseSampleRate).toBe("function");
    expect(typeof stripAuthority).toBe("function");
    expect(NO_PSEUDONYMS.pseudonymizeUserId("x")).toBeUndefined();
    expect(REQUEST_ID_HEADER).toBe("x-request-id");
    expect(SENTRY_TRACE_HEADER).toBe("sentry-trace");
    expect(BAGGAGE_HEADER).toBe("baggage");
    expect(SENTRY_REPLAY_ENABLED).toBe(false);
    expect(POSTHOG_EXCEPTION_AUTOCAPTURE).toBe(false);
    expect(DEFAULT_TRACES_SAMPLE_RATE).toBe(0.1);
  });
});
