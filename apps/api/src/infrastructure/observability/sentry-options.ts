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

/** Hosts whose request paths carry a credential. */
const SECRET_PATH_HOSTS: ReadonlySet<string> = new Set(['api.klipy.com']);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

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
  /**
   * No span and no breadcrumb for a call to a provider that puts its key in
   * the URL path, where the scrubber can't tell it from an ordinary path
   * segment. KLIPY's key is one (`/api/v1/<key>/gifs/...`, #4631).
   */
  ignoreOutgoingRequests: (url: string) => SECRET_PATH_HOSTS.has(hostOf(url)),
};

/**
 * The AI SDK integrations this API leaves out altogether (#3280, ADR-28
 * decision 12). With tracing on, SDK v11's default set includes
 * `Anthropic_AI` and `Google_GenAI`, which wrap the provider clients the AI
 * gateway loads (`@anthropic-ai/sdk`, `@google/genai`).
 *
 * Switching their recording off is not enough. `recordInputs: false` and
 * `recordOutputs: false` keep prompts and answers off the `gen_ai.*` spans,
 * but the Anthropic wrapper also sends a failed stream's raw provider error
 * straight to `captureException` (`auto.ai.anthropic.stream_error`), and a
 * provider's 400 can quote the request back. The gateway's adapter drops
 * that message on purpose (`LanguageModelError`); the integration would
 * report it anyway. So neither is installed: the gateway emits its own span
 * (`ai.gateway.call`) with counts and no text.
 *
 * Two layers stay under this for an AI integration that is not removed here
 * (OpenAI, LangChain and the rest are in the default set too, though their
 * SDKs are not installed) or that the SDK renames: `sentryDataCollection`
 * sets `genAI` inputs and outputs off, and the transaction scrubber drops
 * every span attribute outside its allowlist, which has no `gen_ai.*` key.
 */
export const SENTRY_REMOVED_INTEGRATION_NAMES = [
  'Anthropic_AI',
  'Google_GenAI',
] as const;

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
 * rest), replace the two that would otherwise attach PII-shaped bags, and
 * leave out the two AI SDK ones ({@link SENTRY_REMOVED_INTEGRATION_NAMES}).
 *
 * Do not add `@opentelemetry/sdk-node` (ADR-22). Sentry's own
 * instrumentation produces the API's spans without any OpenTelemetry tracer
 * provider; see `enableOpenTelemetrySetup` below.
 */
export function withSafeSentryIntegrations(
  defaults: SentryIntegration[],
): SentryIntegration[] {
  const removed: readonly string[] = SENTRY_REMOVED_INTEGRATION_NAMES;
  return defaults
    .filter((integration) => !removed.includes(integration.name))
    .map((integration) => {
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
     * spec pins it. `true` is not a small switch: it registers Sentry's
     * tracer provider and propagator as the OpenTelemetry globals, and moves
     * request isolation (scopes, the per-request `request_id` tag) from the
     * AsyncLocalStorage strategy onto OpenTelemetry context. The only thing
     * it would add is capture of spans made through `@opentelemetry/api`,
     * and nothing here makes any.
     */
    enableOpenTelemetrySetup: false,
    /**
     * Send a `captureMessage` report as a plain message event. The SDK's
     * default, `true`, attaches the caller's stack as a synthetic exception,
     * one with a stack and no error type, and Sentry titles a synthetic
     * exception by the function in its top frame. Every message report leaves
     * through `reportSwallowed`, so each one was titled `reportSwallowed` and
     * the issue list could not tell an auth spike from a worker outage
     * (#3906). A plain message event is titled by its message. What the stack
     * said, which site reported, is in each report's tags and in the
     * fingerprint `reportSwallowed` requires of a message.
     * Exceptions are untouched: the option only reaches message events.
     */
    attachStacktrace: false,
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
