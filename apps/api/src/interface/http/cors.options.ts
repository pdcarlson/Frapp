import {
  BAGGAGE_HEADER,
  REQUEST_ID_HEADER,
  SENTRY_TRACE_HEADER,
} from './correlation-headers';

/**
 * The CORS contract the dashboard and Expo-web origins actually hit.
 *
 * Lives here rather than inline in `main.ts` so production and the test
 * harness share one list — the same reason `VALIDATION_PIPE_OPTIONS` and
 * `configureApp` exist. Leaving `exposedHeaders` only on the process that
 * `NestFactory.create`s would mean e2e never sees the headers a browser
 * is allowed to read, which is how a missing `x-request-id` expose (and
 * the report/search truncation flags before it) stays invisible.
 *
 * `allowedHeaders` is deliberately unset: the `cors` package then reflects
 * `Access-Control-Request-Headers`, so a new non-safelisted request header
 * does not need a second edit here to pass preflight. Response headers are
 * the opposite — only names in `exposedHeaders` reach browser JS.
 */
export const CORS_EXPOSED_HEADERS = [
  // Only CORS-safelisted response headers reach browser JS unless named here.
  // The dashboard is cross-origin (api.frapp.live vs app.frapp.live). See
  // spec/behavior/reports.md § Row limits.
  'X-Report-Truncated',
  'X-Report-Row-Limit',
  'X-Report-Truncation-Note',
  // spec/behavior/search.md: distinguish "no matches" from "we stopped looking".
  'X-Search-Timeout',
  'X-Search-Timeout-Sources',
  REQUEST_ID_HEADER,
  SENTRY_TRACE_HEADER,
  BAGGAGE_HEADER,
] as const;

export const CORS_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3002',
  /^https:\/\/(?:[a-zA-Z0-9-]+\.)*frapp\.live$/,
];

export const CORS_OPTIONS = {
  origin: CORS_ALLOWED_ORIGINS,
  credentials: true,
  exposedHeaders: [...CORS_EXPOSED_HEADERS],
};
