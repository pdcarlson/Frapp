import type { NextFunction, Response } from 'express';
import { requestIdMiddleware } from './request-id.middleware';
import type { RequestContext } from '../types/request-context.types';

/**
 * The placement is the point: this runs before guards, so a denial still has a
 * trace id. `spec/behavior/observability.md` § Request Tracing requires the id
 * in every log entry and every error response, denials included.
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
    expect(setHeader).toHaveBeenCalledWith('x-request-id', request.requestId);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('honours a caller-supplied trace id', () => {
    const { request, setHeader } = run({ 'x-request-id': 'caller-trace-1' });

    expect(request.requestId).toBe('caller-trace-1');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'caller-trace-1');
  });

  it('gives distinct ids to distinct requests', () => {
    expect(run().request.requestId).not.toBe(run().request.requestId);
  });
});
