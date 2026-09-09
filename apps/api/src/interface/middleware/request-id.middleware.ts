import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import * as Sentry from '@sentry/nestjs';
import { REQUEST_ID_HEADER } from '../http/correlation-headers';
import { getHeaderValue, RequestContext } from '../types/request-context.types';
import { runWithRequestLogStore } from '../../infrastructure/observability/request-als';

/**
 * Assign the request-tracing id, as **middleware** rather than an interceptor.
 *
 * This was a global interceptor, and that placement silently broke the guarantee
 * `spec/behavior/observability.md` § Request Tracing makes — that the id appears
 * "in all log entries and all error responses". Nest's pipeline runs
 * middleware → **guards** → interceptors, so a request rejected by a guard never
 * reached the interceptor: every 401, 403, and 429 the API has ever returned
 * carried `"requestId": "unknown"` in its body, and there was no id to correlate
 * the denial with anything.
 *
 * That was invisible until the security-event records (#846) started reporting
 * denials and every one of them came out unattributable.
 *
 * As middleware it runs before guards, so the id exists for the whole lifecycle
 * — denials included. An inbound `x-request-id` is still honoured so a caller
 * can thread its own request id through, and it is always echoed on the
 * response. `sentry-trace` / `baggage` are a different identifier space (ADR-22)
 * and never become this value.
 *
 * The same run binds AsyncLocalStorage so Nest `Logger` calls from services
 * (not only the HTTP interceptor) carry the id, and tags the Sentry isolation
 * scope so a trace can be joined to the request-correlation id without
 * *being* that id.
 */
export function requestIdMiddleware(
  request: RequestContext,
  response: Response,
  next: NextFunction,
): void {
  const inbound = getHeaderValue(request.headers, REQUEST_ID_HEADER);
  const requestId = inbound ?? `req_${randomUUID()}`;
  request.requestId = requestId;
  response.setHeader(REQUEST_ID_HEADER, requestId);
  Sentry.getIsolationScope().setTag('request_id', requestId);
  runWithRequestLogStore({ requestId }, () => next());
}
