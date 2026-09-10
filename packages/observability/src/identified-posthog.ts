/**
 * Identified PostHog / Sentry-correlation helpers for web and React Native.
 *
 * This module is **not** on the package barrel. Landing must not import it —
 * it has identify / group / opt-out / hex `posthog_distinct_id`. Anonymous
 * Next.js wiring is a separate extract on `@repo/observability/next`
 * (PR #2070).
 */

export {
  validatedDistinctId,
  validatedChapterGroupId,
  fetchAnalyticsIdentity,
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
  resetPostHog,
  getPostHogDistinctId,
  getPostHogSessionId,
  getPostHogReplayId,
  isProductFlagEnabled,
  captureSentryErrorCorrelated,
} from "./posthog-adapter";
export type { PostHogAdapter, MemoryPostHogCall } from "./posthog-adapter";

export {
  attachPostHogCorrelation,
  withPostHogSentryCorrelation,
  headerValue,
  httpStatusClass,
} from "./sentry-posthog-correlation";
export type { CorrelatableSentryEvent } from "./sentry-posthog-correlation";
