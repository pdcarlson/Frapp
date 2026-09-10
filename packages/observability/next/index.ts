/**
 * `@repo/observability/next` — anonymous-safe Next.js wiring.
 *
 * Init *calls* stay in each app (`Sentry.init`, `posthog.init`). This
 * entry builds the options those calls pass: replay off, exception
 * autocapture off, scrubber with `NO_PSEUDONYMS`, debug IDs, path-only
 * analytics, session/replay correlation tags.
 *
 * **This module has no identify / group / alias / `setUser` /
 * `posthog_distinct_id` APIs.** Web keeps identity in `apps/web`. Landing
 * must import only this entry (plus the CJS policy barrel), never web's
 * identity helpers.
 *
 * Webpack-plugin options live on the Node-only subpath
 * `@repo/observability/next/sentry-build-config.js` so this barrel (imported
 * by client instrumentation) never loads them.
 */

export {
  buildAnonymousBrowserSentryOptions,
  buildAnonymousServerSentryOptions,
} from "./sentry-options";
export type { AnonymousNextSentryRuntime } from "./sentry-options";

export {
  attachAnonymousPostHogCorrelation,
  headerValue,
  httpStatusClass,
  statusFrom,
  traceIdFrom,
  withAnonymousPostHogSentryCorrelation,
} from "./sentry-correlation";
export type {
  AnonymousBeforeSend,
  AnonymousPostHogCorrelationSource,
  AnonymousSentryEvent,
} from "./sentry-correlation";

export {
  ANONYMOUS_POSTHOG_SESSION_RECORDING,
  POSTHOG_PROPERTY_DENYLIST,
  buildAnonymousPostHogBrowserOptions,
  sanitizeAnonymousPostHogCapture,
  sanitizeAnonymousPostHogProperties,
  sanitizeIdentifiedPostHogCapture,
  shouldEnablePostHogReplay,
} from "./posthog-options";
