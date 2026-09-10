/**
 * Anonymous Next.js (landing) PostHog helpers.
 *
 * This entry has no identify / alias / group / hex `posthog_distinct_id`.
 * Web and mobile use `@repo/observability/identified-posthog` instead.
 */

export {
  createMemoryPostHogAdapter,
  bindPostHogAdapterForTests,
  canStartLivePostHogInit,
  setLivePostHogAdapter,
  captureAnalyticsEvent,
} from "./posthog-adapter";
export type { PostHogAdapter, MemoryPostHogCall } from "./posthog-adapter";

export {
  attachAnonymousPostHogCorrelation,
  withAnonymousPostHogSentryCorrelation,
} from "./sentry-posthog-correlation";
export type { CorrelatableSentryEvent } from "./sentry-posthog-correlation";
