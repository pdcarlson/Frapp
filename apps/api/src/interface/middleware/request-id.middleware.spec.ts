import type { NextFunction, Response } from 'express';
import {
  BAGGAGE_HEADER,
  REQUEST_ID_HEADER,
  SENTRY_TRACE_HEADER,
} from '../http/correlation-headers';
import { requestIdMiddleware } from './request-id.middleware';
import type { RequestContext } from '../types/request-context.types';

/**
 * The placement is the point: this runs before guards, so a denial still has a
 * request id. `spec/behavior/observability.md` § Request Tracing requires the
 * id in every log entry and every error response, denials included.
 */
describe('requestIdMiddleware', () => {
  function run(headers: Record<string, string> = {}) {
    const request = { headers } as unknown as RequestContext;
    const setHeader = jest.fn();
    const next = jest.fn() as unknown as NextFunction;
    requestIdMiddleware(request, { setHeader } as unknown as Response, next);
    return { request, setHeader, next };
  }

  it('generates a prefixed id and echoes it on the response', () => {
    const { request, setHeader, next } = run();

    expect(request.requestId).toMatch(/^req_[0-9a-f-]{36}$/);
    expect(setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      request.requestId,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('honours a caller-supplied request id', () => {
    const { request, setHeader } = run({
      [REQUEST_ID_HEADER]: 'caller-req-1',
    });

    expect(request.requestId).toBe('caller-req-1');
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'caller-req-1');
  });

  it('does not treat sentry-trace or baggage as the request id', () => {
    const { request, setHeader } = run({
      [SENTRY_TRACE_HEADER]: '00-traceid-spanid-01',
      [BAGGAGE_HEADER]: 'sentry-environment=staging',
    });

    expect(request.requestId).toMatch(/^req_[0-9a-f-]{36}$/);
    expect(request.requestId).not.toBe('00-traceid-spanid-01');
    expect(setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      request.requestId,
    );
  });

  it('keeps an inbound request id even when trace headers are also present', () => {
    const { request } = run({
      [REQUEST_ID_HEADER]: 'client-req-9',
      [SENTRY_TRACE_HEADER]: '00-traceid-spanid-01',
      [BAGGAGE_HEADER]: 'sentry-environment=staging',
    });

    expect(request.requestId).toBe('client-req-9');
  });

  it('gives distinct ids to distinct requests', () => {
    expect(run().request.requestId).not.toBe(run().request.requestId);
  });
});
