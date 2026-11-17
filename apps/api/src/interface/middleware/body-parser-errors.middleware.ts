import { HttpException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * The body parsers' refusals, as the client's mistake (#4404).
 *
 * `body-parser` raises an `http-errors` error, not an `HttpException`. Nest
 * passed most through untouched, so `AllExceptionsFilter` answered them 500
 * and reported them to Sentry as server faults; a malformed JSON body it
 * mapped to a 400 carrying the parser's message, which V8 writes with the
 * body's own text in it (`Unexpected token 'p', "password=…" is not valid
 * JSON`).
 *
 * Recognised narrowly: each `type` below with the 4xx status body-parser
 * gives it, never any error that happens to carry a `status`. The parser's
 * server-side faults (`stream.encoding.set`, `stream.not.readable`) are not
 * here and stay 500s. The message is fixed here, and neither the parser's
 * message nor its `body` property (the raw text) is read.
 */
const REFUSALS: Readonly<Record<string, { status: number; message: string }>> =
  {
    'entity.parse.failed': {
      status: 400,
      message: 'Request body is not valid JSON',
    },
    'querystring.parse.rangeError': {
      status: 400,
      message: 'Request body is nested too deeply',
    },
    'request.aborted': { status: 400, message: 'Request was aborted' },
    'request.size.invalid': {
      status: 400,
      message: 'Request body does not match its declared length',
    },
    'entity.too.large': { status: 413, message: 'Request body is too large' },
    'parameters.too.many': {
      status: 413,
      message: 'Request body has too many parameters',
    },
    'charset.unsupported': {
      status: 415,
      message: 'Request body charset is not supported',
    },
    'encoding.unsupported': {
      status: 415,
      message: 'Request body encoding is not supported',
    },
  };

export function bodyParserErrorMiddleware(
  error: unknown,
  _request: Request,
  _response: Response,
  next: NextFunction,
): void {
  next(toClientError(error) ?? error);
}

function toClientError(error: unknown): HttpException | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { type, status } = error as { type?: unknown; status?: unknown };
  if (typeof type !== 'string' || !Object.hasOwn(REFUSALS, type)) {
    return undefined;
  }
  const refusal = REFUSALS[type];
  return status === refusal.status
    ? new HttpException(refusal.message, refusal.status)
    : undefined;
}
