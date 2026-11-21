/**
 * Identified PostHog / Sentry-correlation helpers for web and React Native.
 *
 * This module is **not** on the package barrel. Landing must not import it —
 * it has identify / group / opt-out / hex `posthog_distinct_id` / product
 * flags. Anonymous Next.js wiring lives on `@repo/observability/next`.
 */

export {
  /**
   * @public The hex validators are this entry's documented surface
   * (`spec/behavior/observability.md`), unconsumed until a client needs one.
   */
  validatedDistinctId,
  /** @public See `validatedDistinctId`. */
  validatedChapterGroupId,
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
  /**
   * @public The documented client flag check (`spec/behavior/observability.md`
   * § Client product flags); no web or mobile code calls it yet.
   */
  isProductFlagEnabled,
  captureSentryErrorCorrelated,
  createRouteViewRecorder,
} from "./posthog-adapter";

export {
  /**
   * @public The documented identified Sentry attach
   * (`spec/behavior/observability.md`); clients reach it through
   * `withPostHogSentryCorrelation`.
   */
  attachPostHogCorrelation,
  withPostHogSentryCorrelation,
} from "./sentry-posthog-correlation";
