/**
 * `@repo/observability` — browser-safe shared policy for Sentry/PostHog.
 *
 * This package owns scrubbing, correlation types, sample-rate parsing, and
 * the constants that describe the intended split. It does **not** call
 * `Sentry.init` or construct a PostHog client. Those stay runtime-local to
 * NestJS, Next.js, and React Native.
 *
 * No DOM, no `node:*`, no `process.env`. The API is a CommonJS consumer, so
 * this package does not declare `"type": "module"` and its `dist` is CJS.
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
  OBSERVABILITY_PROVIDERS,
  SENTRY_ERROR_CORRELATED_EVENT,
} from "./policy";
