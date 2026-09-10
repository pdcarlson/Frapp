/**
 * Request-correlation and vendor-trace header names.
 *
 * Names live in `@repo/observability` so API CORS, middleware, and clients
 * cannot invent a second spelling. This module re-exports them for the
 * HTTP layer (CORS `exposedHeaders`, `requestIdMiddleware`) without copying
 * the literals.
 *
 * `x-request-id` is not a Sentry/OTEL trace id. Clients mint one (web/mobile
 * `createFrappClient`); the API honours inbound or mints `req_<uuid>`. Trace
 * headers travel beside it so Sentry can continue a browser span without
 * collapsing the two identifier spaces.
 *
 * Contract: `spec/behavior/observability.md` § Correlation schema.
 */
export {
  BAGGAGE_HEADER,
  REQUEST_ID_HEADER,
  SENTRY_TRACE_HEADER,
} from '@repo/observability';
