import {
  buildAnonymousBrowserSentryOptions,
  buildAnonymousServerSentryOptions,
} from "@repo/observability/next";
import type { BrowserOptions, NodeOptions } from "@sentry/nextjs";

/**
 * Landing Sentry DSN + runtime env (issue #2041).
 *
 * Option construction (scrubber with `NO_PSEUDONYMS`, both hooks, replay
 * off) lives in `@repo/observability/next`. This file only reads env so Next
 * inlines `NEXT_PUBLIC_LANDING_SENTRY_DSN` — never `NEXT_PUBLIC_SENTRY_DSN`
 * (`frapp-web`; Infisical path `/` dumps both).
 *
 * Landing is anonymous: no analytics identity fetch, no `Sentry.setUser`.
 */

export function landingSentryDsn(): string | undefined {
  return process.env.NEXT_PUBLIC_LANDING_SENTRY_DSN || undefined;
}

export function landingSentryRelease(): string | undefined {
  return process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined;
}

function landingRuntime(dsn: string) {
  return {
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
    release: landingSentryRelease(),
    tracesSampleRateRaw: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
    tracePropagationTargets: [] as string[],
  };
}

export function buildLandingSentryOptions(dsn: string): BrowserOptions {
  return buildAnonymousBrowserSentryOptions(
    landingRuntime(dsn),
  ) as BrowserOptions;
}

export function buildLandingServerSentryOptions(dsn: string): NodeOptions {
  return buildAnonymousServerSentryOptions(
    landingRuntime(dsn),
  ) as NodeOptions;
}
