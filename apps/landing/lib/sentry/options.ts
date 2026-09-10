import {
  createNoPseudonymScrubHooks,
  parseTracesSampleRate,
  SENTRY_ERROR_SAMPLE_RATE,
  SENTRY_REPLAY_ENABLED,
} from "@repo/observability";
import type { BrowserOptions, NodeOptions } from "@sentry/nextjs";

/**
 * Landing Sentry (#2041). Anonymous: no identity fetch, no Sentry user, no
 * salt. Ingest is `NEXT_PUBLIC_LANDING_SENTRY_DSN` → `frapp-landing`. Do not
 * read `NEXT_PUBLIC_SENTRY_DSN` — Infisical path `/` would otherwise point
 * this site at `frapp-web`.
 */

const hooks = createNoPseudonymScrubHooks();

type BrowserError = Parameters<NonNullable<BrowserOptions["beforeSend"]>>[0];
type BrowserTxn = Parameters<
  NonNullable<BrowserOptions["beforeSendTransaction"]>
>[0];
type ServerError = Parameters<NonNullable<NodeOptions["beforeSend"]>>[0];
type ServerTxn = Parameters<
  NonNullable<NodeOptions["beforeSendTransaction"]>
>[0];

export function landingSentryDsn(): string | undefined {
  // Direct member access so Next inlines the public DSN. Empty → no-op.
  return process.env.NEXT_PUBLIC_LANDING_SENTRY_DSN || undefined;
}

export function landingSentryRelease(): string | undefined {
  return process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined;
}

function landingSharedFields() {
  const release = landingSentryRelease();
  const tracesSampleRate = parseTracesSampleRate(
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
    { envName: "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE" },
  );
  return {
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
    tracesSampleRate,
    sendDefaultPii: false as const,
    ...(release ? { release } : {}),
    ...(SENTRY_ERROR_SAMPLE_RATE === 1
      ? {}
      : { sampleRate: SENTRY_ERROR_SAMPLE_RATE }),
  };
}

/** Replay off. No API calls, so no trace-header targets. */
export function buildLandingSentryOptions(dsn: string): BrowserOptions {
  return {
    dsn,
    ...landingSharedFields(),
    replaysSessionSampleRate: SENTRY_REPLAY_ENABLED ? 0.1 : 0,
    replaysOnErrorSampleRate: SENTRY_REPLAY_ENABLED ? 0.1 : 0,
    tracePropagationTargets: [],
    beforeSend: (event: BrowserError) => hooks.scrubError(event),
    beforeSendTransaction: (event: BrowserTxn) =>
      hooks.scrubTransaction(event),
  };
}

export function buildLandingServerSentryOptions(dsn: string): NodeOptions {
  return {
    dsn,
    ...landingSharedFields(),
    beforeSend: (event: ServerError) => hooks.scrubError(event),
    beforeSendTransaction: (event: ServerTxn) =>
      hooks.scrubTransaction(event),
  };
}
