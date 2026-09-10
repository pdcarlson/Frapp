import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRACES_SAMPLE_RATE,
  NO_PSEUDONYMS,
  POSTHOG_EXCEPTION_AUTOCAPTURE,
  BAGGAGE_HEADER,
  REQUEST_ID_HEADER,
  SENTRY_TRACE_HEADER,
  SENTRY_ERROR_CORRELATED_EVENT,
  SENTRY_ERROR_CORRELATED_PROPERTY_KEYS,
  SENTRY_REPLAY_ENABLED,
  DEFAULT_POSTHOG_LOGS_SAMPLE_RATE,
  createSentryScrubber,
  createNoPseudonymScrubHooks,
  parseSampleRate,
  pathOnlyAnalyticsPath,
  pickSentryErrorCorrelatedProperties,
  stripAuthority,
  shouldEnablePostHogReplay,
  FIRST_PARTY_API_ORIGINS,
  firstPartyTracePropagationTargets,
} from "./index";
import * as barrel from "./index";
import * as anonymousNext from "../next";

describe("public API", () => {
  it("exports the scrubber, parser, and policy constants from the barrel", () => {
    expect(typeof createSentryScrubber).toBe("function");
    expect(typeof parseSampleRate).toBe("function");
    expect(typeof stripAuthority).toBe("function");
    expect(typeof shouldEnablePostHogReplay).toBe("function");
    expect(typeof createNoPseudonymScrubHooks).toBe("function");
    expect(NO_PSEUDONYMS.pseudonymizeUserId("x")).toBeUndefined();
    expect(REQUEST_ID_HEADER).toBe("x-request-id");
    expect(SENTRY_TRACE_HEADER).toBe("sentry-trace");
    expect(BAGGAGE_HEADER).toBe("baggage");
    expect(SENTRY_REPLAY_ENABLED).toBe(false);
    expect(POSTHOG_EXCEPTION_AUTOCAPTURE).toBe(false);
    expect(SENTRY_ERROR_CORRELATED_EVENT).toBe("sentry-error-correlated");
    expect(SENTRY_ERROR_CORRELATED_PROPERTY_KEYS).toEqual([
      "sentry_event_id",
      "trace_id",
      "request_id",
      "route",
      "status_class",
      "release",
    ]);
    expect(typeof pickSentryErrorCorrelatedProperties).toBe("function");
    expect(typeof pathOnlyAnalyticsPath).toBe("function");
    expect(typeof firstPartyTracePropagationTargets).toBe("function");
    expect(FIRST_PARTY_API_ORIGINS).toEqual([
      "http://localhost:3001",
      "https://api-staging.frapp.live",
      "https://api.frapp.live",
    ]);
    expect(DEFAULT_POSTHOG_LOGS_SAMPLE_RATE).toBe(1);
    expect(DEFAULT_TRACES_SAMPLE_RATE).toBe(0.1);
  });

  it("does not export identify / groups / hex attach from the barrel", () => {
    expect("validatedDistinctId" in barrel).toBe(false);
    expect("applyAnalyticsIdentity" in barrel).toBe(false);
    expect("applyObservabilityIdentity" in barrel).toBe(false);
    expect("applyFetchedObservabilityIdentity" in barrel).toBe(false);
    expect("namedAnalyticsEventBody" in barrel).toBe(false);
    expect("observabilityIdentityQueryOptions" in barrel).toBe(false);
    expect("isObservabilityIdentitySubjectReady" in barrel).toBe(false);
    expect("createMemoryPostHogAdapter" in barrel).toBe(false);
    expect("attachPostHogCorrelation" in barrel).toBe(false);
    expect("withPostHogSentryCorrelation" in barrel).toBe(false);
  });

  it("keeps identify off the anonymous Next.js entry", () => {
    expect(typeof anonymousNext.withAnonymousPostHogSentryCorrelation).toBe(
      "function",
    );
    expect(typeof anonymousNext.buildAnonymousBrowserSentryOptions).toBe(
      "function",
    );
    expect(typeof anonymousNext.buildAnonymousPostHogBrowserOptions).toBe(
      "function",
    );
    expect("applyAnalyticsIdentity" in anonymousNext).toBe(false);
    expect("applyObservabilityIdentity" in anonymousNext).toBe(false);
    expect("attachPostHogCorrelation" in anonymousNext).toBe(false);
    expect("withPostHogSentryCorrelation" in anonymousNext).toBe(false);
    expect("createMemoryPostHogAdapter" in anonymousNext).toBe(false);
  });
});
