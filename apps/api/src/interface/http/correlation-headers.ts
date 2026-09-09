/**
 * Request-correlation and vendor-trace header names.
 *
 * `x-request-id` is not a Sentry/OTEL trace id. Clients mint one (web/mobile
 * `createFrappClient`); the API honours inbound or mints `req_<uuid>`. Trace
 * headers travel beside it so a future Sentry tracer can continue a browser
 * span without collapsing the two identifier spaces.
 *
 * Contract: `spec/behavior/observability.md` § Correlation schema.
 */
export const REQUEST_ID_HEADER = 'x-request-id';
export const SENTRY_TRACE_HEADER = 'sentry-trace';
export const BAGGAGE_HEADER = 'baggage';
