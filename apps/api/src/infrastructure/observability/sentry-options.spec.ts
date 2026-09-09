import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildSentryOptions,
  SENTRY_HTTP_INTEGRATION_OPTIONS,
  SENTRY_NODE_FETCH_INTEGRATION_OPTIONS,
  withSafeSentryIntegrations,
} from './sentry-options';

const FIXTURE_DSN = 'https://fixturekey@o0.ingest.example.invalid/1';

describe('buildSentryOptions — Node tracer ownership', () => {
  const options = () => buildSentryOptions(FIXTURE_DSN);

  it('leaves Sentry as the OpenTelemetry provider', () => {
    // ADR-22: a second global tracer corrupts context. `true` would mean we
    // had to install `@opentelemetry/sdk-node` ourselves.
    expect(options().skipOpenTelemetrySetup).toBe(false);
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
    expect(SENTRY_HTTP_INTEGRATION_OPTIONS.maxIncomingRequestBodySize).toBe(
      'none',
    );
    expect(
      SENTRY_HTTP_INTEGRATION_OPTIONS.ignoreIncomingRequestBody('/health', {
        method: 'GET',
      }),
    ).toBe(true);
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

  it('wires the safe-integrations mapper as the production integrations hook', () => {
    expect(options().integrations).toBe(withSafeSentryIntegrations);
  });
});
