import {
  BAGGAGE_HEADER,
  REQUEST_ID_HEADER,
  SENTRY_TRACE_HEADER,
} from './correlation-headers';
import {
  CORS_ALLOWED_ORIGINS,
  CORS_EXPOSED_HEADERS,
  CORS_OPTIONS,
} from './cors.options';

describe('CORS_OPTIONS', () => {
  it('exposes request-id and Sentry trace headers to browser JS', () => {
    expect(CORS_EXPOSED_HEADERS).toEqual(
      expect.arrayContaining([
        REQUEST_ID_HEADER,
        SENTRY_TRACE_HEADER,
        BAGGAGE_HEADER,
      ]),
    );
    expect(CORS_OPTIONS.exposedHeaders).toEqual([...CORS_EXPOSED_HEADERS]);
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

  it('allowlists local web/Expo-web and *.frapp.live with credentials', () => {
    expect(CORS_ALLOWED_ORIGINS).toEqual(
      expect.arrayContaining([
        'http://localhost:3000',
        'http://localhost:3002',
      ]),
    );
    expect(CORS_OPTIONS.credentials).toBe(true);
    expect(CORS_OPTIONS.origin).toBe(CORS_ALLOWED_ORIGINS);
  });
});
