import {
  buildAnonymousBrowserSentryOptions,
  buildAnonymousServerSentryOptions,
} from "@repo/observability/next";
import type { BrowserOptions, NodeOptions } from "@sentry/nextjs";
import { webTracePropagationTargets } from "./trace-targets";

/**
 * Web Sentry DSN + first-party trace targets (issue #865).
 *
 * Anonymous option construction lives in `@repo/observability/next`.
 * Identity does **not**: `observability-identity-provider.tsx` uses
 * `@repo/observability/identified-posthog` to read
 * `GET /v1/analytics/identity` and call `Sentry.setUser` with the
 * server-derived hex. This module never imports `posthog-js`.
 *
 * Direct `process.env.NEXT_PUBLIC_SENTRY_DSN` so Next inlines it.
 */

export function webSentryDsn(): string | undefined {
  return process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;
}

export function webSentryRelease(): string | undefined {
  return process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined;
}

function webRuntime(dsn: string) {
  return {
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
    release: webSentryRelease(),
    tracesSampleRateRaw: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
    tracePropagationTargets: webTracePropagationTargets(),
  };
}

export function buildWebSentryOptions(dsn: string): BrowserOptions {
  return buildAnonymousBrowserSentryOptions(webRuntime(dsn)) as BrowserOptions;
}

export function buildServerSentryOptions(dsn: string): NodeOptions {
  return buildAnonymousServerSentryOptions(webRuntime(dsn)) as NodeOptions;
}
