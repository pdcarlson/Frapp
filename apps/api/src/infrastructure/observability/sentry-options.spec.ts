import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Sentry from '@sentry/nestjs';
import {
  buildSentryOptions,
  SENTRY_HTTP_INTEGRATION_OPTIONS,
  SENTRY_NODE_FETCH_INTEGRATION_OPTIONS,
  SENTRY_REMOVED_INTEGRATION_NAMES,
  SENTRY_REPLACED_INTEGRATION_NAMES,
  withSafeSentryIntegrations,
} from './sentry-options';

const FIXTURE_DSN = 'https://fixturekey@o0.ingest.example.invalid/1';

// Call-through wrappers, so a test can see what the two replacement
// integrations are built with. `jest.spyOn` cannot redefine them: the
// compiled namespace import exposes the SDK's exports as fixed getters.
jest.mock('@sentry/nestjs', () => {
  const actual =
    jest.requireActual<typeof import('@sentry/nestjs')>('@sentry/nestjs');
  return {
    ...actual,
    httpIntegration: jest.fn(actual.httpIntegration),
    nativeNodeFetchIntegration: jest.fn(actual.nativeNodeFetchIntegration),
  };
});

describe('buildSentryOptions — Node tracer ownership', () => {
  const options = () => buildSentryOptions(FIXTURE_DSN);

  it('does not register an OpenTelemetry tracer provider', () => {
    // ADR-22: Sentry owns the API's tracing, and under SDK v11 it needs no
    // OpenTelemetry provider to do so. `true` would also move request
    // isolation onto OpenTelemetry context (see the option's comment).
    expect(options().enableOpenTelemetrySetup).toBe(false);
  });

  it('does not add a second tracer package beside @sentry/nestjs', () => {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { name: string; dependencies?: Record<string, string> };
    expect(pkg.name).toBe('api');
    expect(pkg.dependencies?.['@sentry/nestjs']).toBeDefined();
    expect(pkg.dependencies?.['@opentelemetry/sdk-node']).toBeUndefined();
  });

  it('does not collect incoming request bodies on HTTP spans', () => {
    expect(SENTRY_HTTP_INTEGRATION_OPTIONS.maxRequestBodySize).toBe('none');
    // It takes no arguments, so it ignores every request the SDK asks about.
    expect(SENTRY_HTTP_INTEGRATION_OPTIONS.ignoreRequestBody()).toBe(true);
  });

  it('records no fetch span or breadcrumb for a URL that carries a key (#4631)', () => {
    const ignore = SENTRY_NODE_FETCH_INTEGRATION_OPTIONS.ignoreOutgoingRequests;
    expect(ignore('https://api.klipy.com/api/v1/KEY/gifs/trending')).toBe(true);
    expect(ignore('https://API.KLIPY.com/api/v1/KEY/gifs/search?q=a')).toBe(
      true,
    );
    expect(ignore('https://static.klipy.com/ii/a.webp')).toBe(false);
    expect(ignore('https://api.stripe.com/v1/customers')).toBe(false);
    expect(ignore('not a url')).toBe(false);
  });

  it('does not copy headers onto fetch span attributes', () => {
    expect(
      SENTRY_NODE_FETCH_INTEGRATION_OPTIONS.headersToSpanAttributes,
    ).toEqual({ requestHeaders: [], responseHeaders: [] });
  });

  it('replaces Http and NodeFetch defaults and keeps every other integration', () => {
    const nest = { name: 'Nest' };
    const http = { name: 'Http' };
    const fetch = { name: 'NodeFetch' };
    const out = withSafeSentryIntegrations([http, fetch, nest]);
    expect(out).toHaveLength(3);
    expect(out[0]?.name).toBe('Http');
    expect(out[0]).not.toBe(http);
    expect(out[1]?.name).toBe('NodeFetch');
    expect(out[1]).not.toBe(fetch);
    expect(out[2]).toBe(nest);
  });

  it('builds the replacements with the safe option objects', () => {
    // The constants are asserted above; this proves they reach the SDK. A
    // swap to `Sentry.httpIntegration()` with no argument keeps the name and
    // returns a new object, so the name checks alone pass it. Bodies would
    // then rest on `dataCollection.httpBodies: []` alone, which the SDK reads
    // only when the size is unset: one layer instead of two.
    const http = jest.mocked(Sentry.httpIntegration);
    const fetch = jest.mocked(Sentry.nativeNodeFetchIntegration);
    http.mockClear();
    fetch.mockClear();
    withSafeSentryIntegrations([{ name: 'Http' }, { name: 'NodeFetch' }]);
    expect(http.mock.calls).toEqual([[SENTRY_HTTP_INTEGRATION_OPTIONS]]);
    expect(fetch.mock.calls).toEqual([[SENTRY_NODE_FETCH_INTEGRATION_OPTIONS]]);
  });

  it('leaves the Anthropic and Google AI integrations out', () => {
    // #3280. Recording switched off would not be enough: the Anthropic
    // wrapper reports a failed stream's raw provider error itself, and a
    // provider's 400 can quote the prompt back.
    const nest = { name: 'Nest' };
    const out = withSafeSentryIntegrations([
      { name: 'Anthropic_AI' },
      nest,
      { name: 'Google_GenAI' },
    ]);
    expect(out).toEqual([nest]);
  });

  it('turns model input and output collection off for every AI integration', () => {
    // The layer under the removal: the AI integrations this file leaves in
    // (OpenAI, LangChain, Vercel AI and the rest are in the default set too)
    // fall back to this, and so would a renamed one.
    expect(options().dataCollection?.genAI).toEqual({
      inputs: false,
      outputs: false,
    });
  });

  it("replaces integrations the SDK's real default set still contains", () => {
    // The swap matches by `name`. If the SDK renames or splits one of these
    // (v11 already calls the server half `Http.Server`), the `switch` in
    // `withSafeSentryIntegrations` matches nothing and the unconfigured
    // default ships silently. This is the test that notices. The synthetic
    // list above cannot, because it spells the names itself.
    // Built with tracing on, as production is: the AI SDK integrations are
    // in the default set only then.
    const defaults = Sentry.getDefaultIntegrations({ tracesSampleRate: 1 })!;
    const out = withSafeSentryIntegrations(defaults);
    const names = defaults.map((integration) => integration.name);
    const kept = new Map(
      out.map((integration) => [integration.name, integration]),
    );
    for (const name of SENTRY_REPLACED_INTEGRATION_NAMES) {
      expect(names).toContain(name);
      expect(kept.get(name)).toBeDefined();
      expect(kept.get(name)).not.toBe(defaults[names.indexOf(name)]);
    }
    // The same guard for the removal: a renamed AI integration would match
    // nothing and ship, error capture and all.
    for (const name of SENTRY_REMOVED_INTEGRATION_NAMES) {
      expect(names).toContain(name);
      expect(kept.has(name)).toBe(false);
    }
    expect(out).toHaveLength(
      defaults.length - SENTRY_REMOVED_INTEGRATION_NAMES.length,
    );
  });

  it('wires the safe-integrations mapper as the production integrations hook', () => {
    expect(options().integrations).toBe(withSafeSentryIntegrations);
  });

  it("keeps LinkedErrors from the SDK's real default set", () => {
    // A rethrown 5xx carries the provider error only on `cause`, and this is
    // the integration that ships it (#2131). `sentry-integration.spec.ts`
    // proves what it ships; this proves production still installs it.
    const names = withSafeSentryIntegrations(
      Sentry.getDefaultIntegrations({})!,
    ).map((integration) => integration.name);
    expect(names).toContain('LinkedErrors');
  });

  it('sets release from RENDER_GIT_COMMIT and omits it when unset', () => {
    const previous = process.env.RENDER_GIT_COMMIT;
    try {
      process.env.RENDER_GIT_COMMIT =
        'd85d933302834b3376c9733a761819020d7b0939';
      expect(options().release).toBe(
        'd85d933302834b3376c9733a761819020d7b0939',
      );
      delete process.env.RENDER_GIT_COMMIT;
      expect(options().release).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.RENDER_GIT_COMMIT;
      else process.env.RENDER_GIT_COMMIT = previous;
    }
  });
});
