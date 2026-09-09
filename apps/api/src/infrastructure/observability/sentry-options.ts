import { parseTracesSampleRate } from '@repo/observability';
import * as Sentry from '@sentry/nestjs';
import type { NodeOptions } from '@sentry/nestjs';
import { scrubSentryEvent, scrubSentryTransaction } from './sentry-scrubbing';

/**
 * One member of the default integration list `Sentry.init` passes to the
 * `integrations` callback. Named through `NodeOptions` so this file does not
 * import `@sentry/core` just for a type `@sentry/nestjs` does not re-export.
 */
type SentryIntegration = Parameters<
  Extract<NonNullable<NodeOptions['integrations']>, (i: never[]) => unknown>
>[0][number];

/**
 * HTTP spans: never attach the request body. `sendDefaultPii: false` is a
 * floor; this is the explicit "none" so a SDK default change cannot start
 * shipping bodies on traces.
 */
export const SENTRY_HTTP_INTEGRATION_OPTIONS = {
  maxIncomingRequestBodySize: 'none' as const,
  ignoreIncomingRequestBody: () => true,
};

/**
 * Fetch spans: do not copy request/response headers onto span attributes.
 * `Authorization` and cookies are the realistic leak; an empty list is
 * allow-nothing, matching the scrubber's header allowlist at the source.
 */
export const SENTRY_NODE_FETCH_INTEGRATION_OPTIONS = {
  headersToSpanAttributes: {
    requestHeaders: [] as string[],
    responseHeaders: [] as string[],
  },
};

/**
 * Keep Sentry's default integration set (HTTP, fetch, Nest, and the
 * auto-performance instrumentations that no-op when the library is absent)
 * and replace only the two that would otherwise attach PII-shaped bags.
 *
 * Do not add `@opentelemetry/sdk-node`. Sentry's init installs the tracer
 * when `skipOpenTelemetrySetup` is false (ADR-22).
 */
export function withSafeSentryIntegrations(
  defaults: SentryIntegration[],
): SentryIntegration[] {
  return defaults.map((integration) => {
    switch (integration.name) {
      case 'Http':
        return Sentry.httpIntegration(SENTRY_HTTP_INTEGRATION_OPTIONS);
      case 'NodeFetch':
        return Sentry.nativeNodeFetchIntegration(
          SENTRY_NODE_FETCH_INTEGRATION_OPTIONS,
        );
      default:
        return integration;
    }
  });
}

/**
 * The single source of truth for how Sentry is configured (issues #481, #682).
 *
 * This lives apart from `main.ts` for one reason: `main.ts` ends in
 * `void bootstrap()`, so importing it to inspect the options would boot the
 * whole application. Extracting the option object is what lets
 * `sentry-integration.spec.ts` assert against the configuration the API
 * actually ships rather than a copy of it — a copy can drift silently, and a
 * test that asserts against its own literals proves nothing about production.
 *
 * `tracesSampleRate` is parsed by `@repo/observability`: a malformed, empty, or
 * out-of-range value falls back to `0.1` and is logged at boot (#2040).
 *
 * Init itself lives in `instrument.ts`, imported first from `main.ts`, so
 * Nest/HTTP OpenTelemetry patches apply before other modules load.
 */
export function buildSentryOptions(dsn: string): NodeOptions {
  return {
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: parseTracesSampleRate(
      process.env.SENTRY_TRACES_SAMPLE_RATE,
      { envName: 'SENTRY_TRACES_SAMPLE_RATE' },
    ),
    /**
     * Sentry owns the Node trace provider (ADR-22). `true` here would mean
     * we had to install our own tracer — the alternative the ADR rejects.
     */
    skipOpenTelemetrySetup: false,
    /**
     * Under v10 this no longer means "collect nothing". It resolves to a
     * key-based filter: `authorization`, `cookie`, and anything else matching
     * the SDK's sensitive-key list come back as `[Filtered]`, request bodies
     * are not collected at all (`httpBodies: []`), and the client IP is not
     * inferred (`userInfo: false`). Values under innocuously-named keys are
     * still collected verbatim, which is why `beforeSend` below does the real
     * work rather than this flag.
     */
    sendDefaultPii: false,
    integrations: withSafeSentryIntegrations,
    /**
     * Every **error** event leaves through here. See `sentry-scrubbing.ts` for
     * the rules and why they are allowlists.
     */
    beforeSend: scrubSentryEvent,
    /**
     * Every **transaction** (tracing) event leaves through here. The SDK routes
     * the two classes to two different hooks, so both must be set or one class
     * ships unscrubbed — which is what #896 fixed.
     *
     * These are deliberately two functions rather than one: `scrubSentryEvent`
     * would drop every span, because `spans` is not on its allowlist, and the
     * transaction would still be delivered — just with an empty trace payload.
     */
    beforeSendTransaction: scrubSentryTransaction,
  };
}
