import {
  parseTracesSampleRate,
  sentryDataCollection,
} from '@repo/observability';
import * as Sentry from '@sentry/nestjs';
import type { NodeOptions } from '@sentry/nestjs';
import { readDeployedCommit } from './deployed-commit';
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
 * HTTP server: never attach the request body. `dataCollection.httpBodies: []`
 * already turns body capture off (the SDK falls back to it only when this
 * size is unset), so this is the explicit "none" that keeps a future default
 * change, or an edit to `dataCollection`, from shipping bodies on its own.
 */
export const SENTRY_HTTP_INTEGRATION_OPTIONS = {
  maxRequestBodySize: 'none' as const,
  ignoreRequestBody: () => true,
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
 * The default integrations {@link withSafeSentryIntegrations} replaces, by
 * the `name` the SDK gives them. Exported so `sentry-options.spec.ts` can
 * assert each one is still in the SDK's real default set: a rename (v11
 * already calls the server half `Http.Server`) would make the swap below
 * match nothing, and the unconfigured defaults would ship with no error.
 */
export const SENTRY_REPLACED_INTEGRATION_NAMES = ['Http', 'NodeFetch'] as const;

/**
 * Keep Sentry's default integration set (HTTP, fetch, Nest, Express, and the
 * rest) and replace only the two that would otherwise attach PII-shaped bags.
 *
 * Do not add `@opentelemetry/sdk-node` (ADR-22). Sentry's own
 * instrumentation produces the API's spans without any OpenTelemetry tracer
 * provider; see `enableOpenTelemetrySetup` below.
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
 * the SDK's load-time module hooks are registered before any `@nestjs/*` or
 * Express module loads (see that file's header).
 */
export function buildSentryOptions(dsn: string): NodeOptions {
  return {
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    /**
     * Spec: API `release` is the git SHA (`RENDER_GIT_COMMIT`). Unset locally
     * and in CI so we do not invent a SHA. Source-map upload uses the same
     * helper as `--release` so classic matching agrees with the envelope.
     */
    release: readDeployedCommit(),
    tracesSampleRate: parseTracesSampleRate(
      process.env.SENTRY_TRACES_SAMPLE_RATE,
      { envName: 'SENTRY_TRACES_SAMPLE_RATE' },
    ),
    /**
     * Sentry owns the API's tracing (ADR-22), and under SDK v11 it does so
     * without an OpenTelemetry tracer provider: it isolates requests with
     * its own AsyncLocalStorage strategy and emits spans from its own
     * instrumentation. `false` is v11's Node default, set explicitly so the
     * spec pins it. `true` would register Sentry's provider as the global
     * one, which only matters for spans made through `@opentelemetry/api`,
     * and nothing here makes any.
     */
    enableOpenTelemetrySetup: false,
    /**
     * What the SDK collects before `beforeSend` runs. v11 replaced
     * `sendDefaultPii` with this object and defaults every category to on,
     * so each one is set explicitly. The values, and why each is set as it
     * is, are in `sentryDataCollection` (`@repo/observability`), shared
     * with both Next apps. The scrubbers below are still the layer that
     * makes an event safe; this keeps data they would drop from being
     * collected at all.
     */
    dataCollection: sentryDataCollection(),
    integrations: withSafeSentryIntegrations,
    /**
     * Every **error** event leaves through here. See `sentry-scrubbing.ts` for
     * the rules and why they are allowlists.
     */
    beforeSend: scrubSentryEvent,
    /**
     * Keep traces on the transaction pipeline, where `beforeSendTransaction`
     * below runs. SDK v11 defaults to `'stream'`, which sends spans in
     * batches and **skips `beforeSendTransaction` entirely**, so under the
     * default every span attribute the transaction scrubber strips
     * (`http.url`, `url.query`, `db.statement`) would ship raw (#2722).
     * Moving to streaming means porting that scrubber to `beforeSendSpan`
     * first; `beforeSendTransaction` goes away in v12.
     */
    traceLifecycle: 'static',
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
