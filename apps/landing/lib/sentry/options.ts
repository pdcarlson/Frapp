import {
  createSentryScrubber,
  NO_PSEUDONYMS,
  parseTracesSampleRate,
  SENTRY_ERROR_SAMPLE_RATE,
  SENTRY_REPLAY_ENABLED,
  type ScrubbableEvent,
} from "@repo/observability";
import type { BrowserOptions, NodeOptions } from "@sentry/nextjs";

/**
 * How landing Sentry is configured (issue #2041, observability WS6).
 *
 * Landing is anonymous: no analytics identity fetch, no Sentry user, no HMAC
 * salt in the bundle. The shared scrubber runs with
 * {@link NO_PSEUDONYMS} so every identifier the free-text sweep finds is
 * replaced with a placeholder (`[redacted:id]`) rather than a stable hash.
 *
 * ## Do not read `NEXT_PUBLIC_SENTRY_DSN`
 *
 * Infisical path `/` syncs the whole environment to both Vercel projects
 * (#834). `NEXT_PUBLIC_SENTRY_DSN` is the `frapp-web` DSN. Landing must ingest
 * into `frapp-landing` via {@link landingSentryDsn} (`NEXT_PUBLIC_LANDING_SENTRY_DSN`)
 * so a marketing-site error never lands in the dashboard stream.
 */

const scrubber = createSentryScrubber(NO_PSEUDONYMS);

type BrowserErrorEvent = Parameters<NonNullable<BrowserOptions["beforeSend"]>>[0];
type BrowserTransactionEvent = Parameters<
  NonNullable<BrowserOptions["beforeSendTransaction"]>
>[0];
type ServerErrorEvent = Parameters<NonNullable<NodeOptions["beforeSend"]>>[0];
type ServerTransactionEvent = Parameters<
  NonNullable<NodeOptions["beforeSendTransaction"]>
>[0];

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

/**
 * Direct `process.env.NEXT_PUBLIC_LANDING_SENTRY_DSN` so Next inlines it at
 * build time. A dynamic lookup is not replaced and would stay `undefined` in
 * the browser. Empty string is unset so a blank Vercel variable no-ops.
 */
export function landingSentryDsn(): string | undefined {
  return process.env.NEXT_PUBLIC_LANDING_SENTRY_DSN || undefined;
}

function environment(): string {
  return process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development";
}

export function landingSentryRelease(): string | undefined {
  return process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined;
}

function sharedRuntimeOptions() {
  const release = landingSentryRelease();
  return {
    environment: environment(),
    ...(release ? { release } : {}),
    tracesSampleRate: parseTracesSampleRate(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
      { envName: "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE" },
    ),
    sendDefaultPii: false as const,
    ...(SENTRY_ERROR_SAMPLE_RATE === 1
      ? {}
      : { sampleRate: SENTRY_ERROR_SAMPLE_RATE }),
  };
}

/**
 * Browser Sentry options. Sentry Replay stays off ({@link SENTRY_REPLAY_ENABLED}).
 * Landing does not call the API, so trace headers are not propagated anywhere.
 */
export function buildLandingSentryOptions(dsn: string): BrowserOptions {
  return {
    dsn,
    ...sharedRuntimeOptions(),
    replaysSessionSampleRate: SENTRY_REPLAY_ENABLED ? 0.1 : 0,
    replaysOnErrorSampleRate: SENTRY_REPLAY_ENABLED ? 0.1 : 0,
    tracePropagationTargets: [],
    beforeSend: (event: BrowserErrorEvent) => scrubError(event),
    beforeSendTransaction: (event: BrowserTransactionEvent) =>
      scrubTransaction(event),
  };
}

export function buildLandingServerSentryOptions(dsn: string): NodeOptions {
  return {
    dsn,
    ...sharedRuntimeOptions(),
    beforeSend: (event: ServerErrorEvent) => scrubError(event),
    beforeSendTransaction: (event: ServerTransactionEvent) =>
      scrubTransaction(event),
  };
}
