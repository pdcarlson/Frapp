import {
  BadRequestException,
  PayloadTooLargeException,
  type HttpException,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * The JSON body parser's two refusals, as the client's mistake (#4404).
 *
 * `body-parser` raises an `http-errors` error, not an `HttpException`. Nest
 * passed a body over the limit through untouched, so `AllExceptionsFilter`
 * answered it 500 and reported it to Sentry as a server fault; a malformed
 * body it mapped to a 400 carrying the parser's message, which V8 writes
 * with the body's own text in it (`Unexpected token 'p', "password=…" is not
 * valid JSON`).
 *
 * Recognised narrowly: one of the two `type`s below with its own numeric
 * status, never any error that happens to carry a `status`. The message is
 * fixed here, and neither the parser's message nor its `body` property (the
 * raw text) is read. Anything else goes on unchanged.
 */
const REFUSALS: Readonly<
  Record<string, { status: number; toException: () => HttpException }>
> = {
  'entity.parse.failed': {
    status: 400,
    toException: () =>
      new BadRequestException('Request body is not valid JSON'),
  },
  'entity.too.large': {
    status: 413,
    toException: () =>
      new PayloadTooLargeException('Request body is too large'),
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
  return status === refusal.status ? refusal.toException() : undefined;
}
