import type { NextFunction, Request, Response } from 'express';
import { runWithRequestReads } from '../../infrastructure/supabase/request-reads';

/**
 * Binds the per-request read store (`request-reads.ts`, #3728) before the Nest
 * pipeline, so a request's guards, and a `GET`'s handler, share the membership
 * and role reads they would otherwise each make. Middleware rather than an
 * interceptor for the same reason as `requestIdMiddleware`: guards run before
 * interceptors, and the guards are the first readers.
 */
export function requestReadsMiddleware(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  runWithRequestReads(request.method, () => next());
}
