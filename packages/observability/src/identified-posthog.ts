/**
 * Identified PostHog / Sentry-correlation helpers for web and React Native.
 *
 * This module is **not** on the package barrel. Landing must not import it —
 * it has identify / group / opt-out / hex `posthog_distinct_id` / product
 * flags. Anonymous Next.js wiring lives on `@repo/observability/next`.
 */

export {
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
  applyFetchedObservabilityIdentity,
  namedAnalyticsEventBody,
  resetPostHog,
  createRouteViewRecorder,
} from "./posthog-adapter";
export type {
  PostHogAdapter,
  MemoryPostHogCall,
  NamedAnalyticsEventApp,
  NamedAnalyticsEventBody,
  NamedAnalyticsEventProperties,
} from "./posthog-adapter";

export { withPostHogSentryCorrelation } from "./sentry-posthog-correlation";
export type { CorrelatableSentryEvent } from "./sentry-posthog-correlation";
