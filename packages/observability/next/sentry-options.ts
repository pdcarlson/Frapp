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
}

const { scrubError, scrubTransaction } = createNoPseudonymScrubHooks();

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
 * Options for the browser's `browserTracingIntegration`, which each app
 * passes in its `integrations` (an app-supplied instance replaces the
 * SDK's default one). This package does not depend on `@sentry/*`, so it
 * holds the options and the apps build the integration.
 *
 * **INP is off** (`webVitals.ignore: ['inp']`). The SDK (v10 and v11 alike) sends each INP measurement as
 * a standalone span, past `beforeSend` and `beforeSendTransaction`, and names
 * it after the clicked element's selector. That selector includes the
 * element's `aria-label`, `title`, `name` and `alt`, which in `apps/web` can
 * hold a member's or a channel's name. The same text also goes out as the
 * envelope's `trace.transaction` header, which no hook can reach. A static
 * `beforeSendSpan` was tried in #2722 and failed on both counts: it could
 * not touch that header, and v11 serialises a static standalone span from
 * `data` alone, so the scrubbed span arrived with no op or value at all.
 * Turn it back on once selector text is scrubbed everywhere it surfaces
 * (#2736). LCP, CLS, FCP and TTFB are unaffected: they ride on the pageload
 * transaction, through the transaction scrubber.
 */
export const SENTRY_BROWSER_TRACING_OPTIONS = {
  // The v11 spelling. The older `enableInp: false` still works but is
  // deprecated, and would stop existing at the next major.
  webVitals: { ignore: ["inp" as const] },
};

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
  };
}
