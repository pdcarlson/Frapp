import type { NextFunction, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getHeaderValue, RequestContext } from '../types/request-context.types';

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
 * can thread its own trace id through, and it is always echoed on the response.
 */
export function requestIdMiddleware(
  request: RequestContext,
  response: Response,
  next: NextFunction,
): void {
  const inbound = getHeaderValue(request.headers, 'x-request-id');
  const requestId = inbound ?? `req_${uuidv4()}`;
  request.requestId = requestId;
  response.setHeader('x-request-id', requestId);
  next();
}
