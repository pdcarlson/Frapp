import {
  createSentryScrubber,
  NO_PSEUDONYMS,
  parseTracesSampleRate,
  SENTRY_ERROR_SAMPLE_RATE,
  SENTRY_REPLAY_ENABLED,
  type ScrubbableEvent,
} from "../src/index";

/**
 * Anonymous Next.js Sentry options: scrubber with {@link NO_PSEUDONYMS},
 * both `beforeSend` hooks, Sentry Replay off.
 *
 * This module does not read `process.env`. Callers pass already-inlined
 * `NEXT_PUBLIC_*` values so Next's static analysis stays in the app file
 * that names the DSN (`NEXT_PUBLIC_SENTRY_DSN` vs
 * `NEXT_PUBLIC_LANDING_SENTRY_DSN`).
 *
 * No identify / `setUser` / `posthog_distinct_id`. Web attaches those in
 * `apps/web`. Landing must not.
 */

export interface AnonymousNextSentryRuntime {
  dsn: string;
  environment: string;
  release?: string;
  tracesSampleRateRaw?: string;
  tracePropagationTargets?: string[];
}

const scrubber = createSentryScrubber(NO_PSEUDONYMS);

function scrubError<T>(event: T): T | null {
  return scrubber.scrubSentryEvent(
    event as unknown as ScrubbableEvent,
  ) as T | null;
}

function scrubTransaction<T>(event: T): T | null {
  return scrubber.scrubSentryTransaction(
    event as unknown as ScrubbableEvent,
  ) as T | null;
}

function sharedRuntimeOptions(runtime: AnonymousNextSentryRuntime) {
  const release = runtime.release || undefined;
  return {
    environment: runtime.environment,
    ...(release ? { release } : {}),
    tracesSampleRate: parseTracesSampleRate(runtime.tracesSampleRateRaw, {
      envName: "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE",
    }),
    sendDefaultPii: false as const,
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
