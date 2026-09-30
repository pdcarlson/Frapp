import {
  BAGGAGE_HEADER,
  REQUEST_ID_HEADER,
  SENTRY_TRACE_HEADER,
} from './correlation-headers';
import {
  CORS_ALLOWED_ORIGINS,
  CORS_EXPOSED_HEADERS,
  corsOptionsFor,
} from './cors.options';

describe('corsOptionsFor', () => {
  it('exposes request-id and Sentry trace headers to browser JS', () => {
    expect(CORS_EXPOSED_HEADERS).toEqual(
      expect.arrayContaining([
        REQUEST_ID_HEADER,
        SENTRY_TRACE_HEADER,
        BAGGAGE_HEADER,
      ]),
    );
    for (const environment of ['production', 'staging', 'local'] as const) {
      expect(corsOptionsFor(environment).exposedHeaders).toEqual([
        ...CORS_EXPOSED_HEADERS,
      ]);
    }
  });

  it('keeps request-id distinct from Sentry trace headers', () => {
    expect(REQUEST_ID_HEADER).not.toBe(SENTRY_TRACE_HEADER);
    expect(REQUEST_ID_HEADER).not.toBe(BAGGAGE_HEADER);
    expect(SENTRY_TRACE_HEADER).not.toBe(BAGGAGE_HEADER);
  });

  it('still exposes the report and search truncation flags', () => {
    expect(CORS_EXPOSED_HEADERS).toEqual(
      expect.arrayContaining([
        'X-Report-Truncated',
        'X-Report-Row-Limit',
        'X-Report-Truncation-Note',
        'X-Search-Timeout',
        'X-Search-Timeout-Sources',
      ]),
    );
  });

  // Exact strings only (#2507): a pattern is how production came to admit
  // the staging dashboard and every other `*.frapp.live` host.
  it('allowlists exact origins per deployment, with credentials', () => {
    expect(CORS_ALLOWED_ORIGINS).toEqual({
      production: ['https://app.frapp.live'],
      staging: [
        'https://app.staging.frapp.live',
        'http://localhost:3000',
        'http://localhost:3002',
      ],
      local: ['http://localhost:3000', 'http://localhost:3002'],
    });
    for (const environment of ['production', 'staging', 'local'] as const) {
      const options = corsOptionsFor(environment);
      expect(options.credentials).toBe(true);
      expect(options.origin).toEqual(CORS_ALLOWED_ORIGINS[environment]);
      expect(options.origin.every((origin) => typeof origin === 'string')).toBe(
        true,
      );
    }
  });
});
