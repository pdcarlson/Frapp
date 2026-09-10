/**
 * Identified PostHog / Sentry-correlation helpers for web and React Native.
 *
 * This module is **not** on the package barrel. Landing must not import it —
 * it has identify / group / opt-out / hex `posthog_distinct_id`. Anonymous
 * Next.js wiring lives on `@repo/observability/next`.
 */

export {
  validatedDistinctId,
  validatedChapterGroupId,
  fetchAnalyticsIdentity,
  observabilityIdentityQueryKey,
  isObservabilityIdentitySubjectReady,
  observabilityIdentityQueryOptions,
} from "./identity";

export {
  createMemoryPostHogAdapter,
  bindPostHogAdapterForTests,
  canStartLivePostHogInit,
  setLivePostHogAdapter,
  isPostHogReady,
  isAnalyticsCaptureOptedOut,
  applyAnalyticsOptOut,
  applyAnalyticsIdentity,
  applyObservabilityIdentity,
  applyFetchedObservabilityIdentity,
  namedAnalyticsEventBody,
  resetPostHog,
  getPostHogDistinctId,
  getPostHogSessionId,
  getPostHogReplayId,
  isProductFlagEnabled,
  captureSentryErrorCorrelated,
  captureAnalyticsEvent,
} from "./posthog-adapter";
export type {
  PostHogAdapter,
  MemoryPostHogCall,
  NamedAnalyticsEventBody,
  NamedAnalyticsEventProperties,
} from "./posthog-adapter";

export {
  attachPostHogCorrelation,
  withPostHogSentryCorrelation,
  headerValue,
  httpStatusClass,
} from "./sentry-posthog-correlation";
export type { CorrelatableSentryEvent } from "./sentry-posthog-correlation";
