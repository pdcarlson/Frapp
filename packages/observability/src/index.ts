/**
 * `@repo/observability` — browser-safe shared policy for Sentry/PostHog.
 *
 * This barrel owns scrubbing, correlation types, sample-rate parsing, and
 * the constants that describe the intended split. It does **not** call
 * `Sentry.init` or construct a PostHog client. Those stay runtime-local to
 * NestJS, Next.js, and React Native.
 *
 * Identified-client helpers (identify / groups / hex `posthog_distinct_id`)
 * are **not** on this barrel. Import `@repo/observability/identified-posthog`
 * from web or mobile. Landing must not import that entry.
 *
 * Anonymous Next.js option builders (replay-off, both scrubber hooks,
 * debug-ID webpack defaults, path-only analytics, session/replay tags)
 * live on `@repo/observability/next`. That entry exports **no** identify /
 * group / `setUser` / `posthog_distinct_id` APIs.
 *
 * No DOM, no `node:*`, no `process.env`. The API is a CommonJS consumer, so
 * this package does not declare `"type": "module"` and its `dist` is CJS.
 * `@repo/observability/next` is TypeScript source consumed via
 * `transpilePackages` and is not compiled into `dist`.
 */

export {
  createSentryScrubber,
  NO_PSEUDONYMS,
  stripAuthority,
} from "./sentry-scrubbing";
export type {
  ScrubbableEvent,
  SentryPseudonymizer,
} from "./sentry-scrubbing";

export {
  DEFAULT_TRACES_SAMPLE_RATE,
  parseSampleRate,
  parseTracesSampleRate,
  formatSampleRateWarning,
} from "./sample-rate";
export type {
  SampleRateParseReason,
  SampleRateParseResult,
} from "./sample-rate";

export {
  REQUEST_ID_HEADER,
  SENTRY_TRACE_HEADER,
  BAGGAGE_HEADER,
  PSEUDONYM_HEX_RE,
  isPseudonymHex,
} from "./correlation";
export type {
  RequestId,
  SentryTraceId,
  SentryEventId,
  PostHogDistinctId,
  PostHogChapterGroupId,
  AnalyticsIdentity,
} from "./correlation";

export {
  SENTRY_ERROR_SAMPLE_RATE,
  SENTRY_REPLAY_ENABLED,
  POSTHOG_EXCEPTION_AUTOCAPTURE,
  POSTHOG_PRODUCTION_REPLAY_ENABLED,
  shouldEnablePostHogReplay,
  OBSERVABILITY_PROVIDERS,
  SENTRY_ERROR_CORRELATED_EVENT,
  SENTRY_ERROR_CORRELATED_PROPERTY_KEYS,
  pickSentryErrorCorrelatedProperties,
  DEFAULT_POSTHOG_LOGS_SAMPLE_RATE,
} from "./policy";

export { pathOnlyAnalyticsPath } from "./analytics-path";

export { createNoPseudonymScrubHooks } from "./sentry-scrub-hooks";

export { headerValue, httpStatusClass } from "./sentry-http";
