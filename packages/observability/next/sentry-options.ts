import {
  createNoPseudonymScrubHooks,
  parseTracesSampleRate,
  SENTRY_ERROR_SAMPLE_RATE,
  SENTRY_REPLAY_ENABLED,
  sentryDataCollection,
} from "../src/index";

/**
 * Anonymous Next.js Sentry options: scrubber with `NO_PSEUDONYMS`,
 * both `beforeSend` hooks, explicit `dataCollection`, Sentry Replay off.
 *
 * This module does not read `process.env`. Callers pass already-inlined
 * `NEXT_PUBLIC_*` values so Next's static analysis stays in the app file
 * that names the DSN (`NEXT_PUBLIC_SENTRY_DSN` vs
 * `NEXT_PUBLIC_LANDING_SENTRY_DSN`).
 *
 * No identify / `setUser` / `posthog_distinct_id`. Identified web/mobile
 * attach those via `@repo/observability/identified-posthog`. Landing must not.
 */

export interface AnonymousNextSentryRuntime {
  dsn: string;
  environment: string;
  release?: string;
  tracesSampleRateRaw?: string;
  tracePropagationTargets?: string[];
  /**
   * The SDK's `withStaticSpan`, passed in because this package does not
   * depend on `@sentry/*`. Under `traceLifecycle: 'static'`, v11 **ignores**
   * a `beforeSendSpan` that is not wrapped with it, and says so only in a
   * debug build. Required, so an app cannot forget it and ship the INP span
   * unscrubbed.
   */
  withStaticSpan: (callback: <T>(span: T) => T) => unknown;
}

const { scrubError, scrubTransaction, scrubStaticSpan } =
  createNoPseudonymScrubHooks();

function sharedRuntimeOptions(runtime: AnonymousNextSentryRuntime) {
  const release = runtime.release || undefined;
  return {
    environment: runtime.environment,
    ...(release ? { release } : {}),
    tracesSampleRate: parseTracesSampleRate(runtime.tracesSampleRateRaw, {
      envName: "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE",
    }),
    // v11 defaults every collection category to on; each is named in
    // `sentryDataCollection`, with the reason for its value (#2722).
    dataCollection: sentryDataCollection(),
    // v11's default, `'stream'`, never calls `beforeSendTransaction`, so the
    // transaction scrubber below would be skipped and spans would ship raw.
    // Streaming needs that scrubber ported to `beforeSendSpan` first.
    traceLifecycle: "static" as const,
    ...(SENTRY_ERROR_SAMPLE_RATE === 1
      ? {}
      : { sampleRate: SENTRY_ERROR_SAMPLE_RATE }),
  };
}

/**
 * Browser Sentry options. Replay sample rates stay 0 while
 * {@link SENTRY_REPLAY_ENABLED} is false.
 */
export function buildAnonymousBrowserSentryOptions(
  runtime: AnonymousNextSentryRuntime,
) {
  return {
    dsn: runtime.dsn,
    ...sharedRuntimeOptions(runtime),
    replaysSessionSampleRate: SENTRY_REPLAY_ENABLED ? 0.1 : 0,
    replaysOnErrorSampleRate: SENTRY_REPLAY_ENABLED ? 0.1 : 0,
    tracePropagationTargets: runtime.tracePropagationTargets ?? [],
    beforeSend: <T>(event: T) => scrubError(event),
    beforeSendTransaction: <T>(event: T) => scrubTransaction(event),
    // The browser's INP span leaves as a standalone span even under the
    // static lifecycle, past both hooks above (#2722). See
    // `scrubSentryStaticSpan` for why every span is rebuilt.
    beforeSendSpan: runtime.withStaticSpan(<T>(span: T) =>
      scrubStaticSpan(span),
    ),
  };
}

/**
 * Server/edge counterpart. Same scrubbing; no replay keys (Node options
 * do not take them).
 */
export function buildAnonymousServerSentryOptions(
  runtime: AnonymousNextSentryRuntime,
) {
  return {
    dsn: runtime.dsn,
    ...sharedRuntimeOptions(runtime),
    beforeSend: <T>(event: T) => scrubError(event),
    beforeSendTransaction: <T>(event: T) => scrubTransaction(event),
    // No INP on the server, but the same fail-closed hook covers any other
    // standalone span the SDK starts sending there.
    beforeSendSpan: runtime.withStaticSpan(<T>(span: T) =>
      scrubStaticSpan(span),
    ),
  };
}
