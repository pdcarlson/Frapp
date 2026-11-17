import { HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { bodyParserErrorMiddleware } from './body-parser-errors.middleware';

/** The shape `body-parser` raises, raw text on `body` included. */
function parserError(type: string, status: unknown): Error {
  return Object.assign(
    new SyntaxError(
      `Unexpected token 'p', "password=hunter2" is not valid JSON`,
    ),
    {
      type,
      status,
      statusCode: status,
      expose: true,
      body: 'password=hunter2',
    },
  );
}

function run(error: unknown): unknown {
  const next = jest.fn();
  bodyParserErrorMiddleware(error, {} as Request, {} as Response, next);
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0][0];
}

describe('bodyParserErrorMiddleware (#4404)', () => {
  it.each([
    ['entity.parse.failed', 400, 'Request body is not valid JSON'],
    ['entity.too.large', 413, 'Request body is too large'],
    ['parameters.too.many', 413, 'Request body has too many parameters'],
    ['charset.unsupported', 415, 'Request body charset is not supported'],
    ['request.aborted', 400, 'Request was aborted'],
  ])('turns %s into a %d with a fixed message', (type, status, message) => {
    const mapped = run(parserError(type, status));

    expect(mapped).toBeInstanceOf(HttpException);
    const exception = mapped as HttpException;
    expect(exception.getStatus()).toBe(status);
    expect(exception.message).toBe(message);
    expect(JSON.stringify(exception.getResponse())).not.toContain('hunter2');
    expect(exception.cause).toBeUndefined();
  });

  // Narrow on purpose: anything else stays the server fault it is.
  it.each([
    [
      'a status with no parser type',
      Object.assign(new Error('x'), { status: 400 }),
    ],
    [
      'a parser type with the wrong status',
      parserError('entity.too.large', 400),
    ],
    [
      'a parser type with a string status',
      parserError('entity.parse.failed', '400'),
    ],
    [
      "a parser fault of the server's own",
      parserError('stream.encoding.set', 500),
    ],
    ['an inherited type name', parserError('toString', 400)],
    ['a non-object', 'boom'],
  ])('passes %s on unchanged', (_name, error) => {
    expect(run(error)).toBe(error);
  });
});
