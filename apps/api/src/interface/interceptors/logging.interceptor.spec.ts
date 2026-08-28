import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { forwardedShape, LoggingInterceptor } from './logging.interceptor';

describe('forwardedShape', () => {
  const shape = (
    header: string | string[] | undefined,
    remoteAddress?: string,
  ) =>
    forwardedShape({
      headers: header === undefined ? {} : { 'x-forwarded-for': header },
      socket: { remoteAddress } as never,
    });

  it('counts a single entry', () => {
    expect(shape('203.0.113.7')).toEqual({
      xffCount: 1,
      xffSocketIsLast: false,
    });
  });

  it('counts a multi-entry chain', () => {
    expect(shape('203.0.113.7, 198.51.100.4, 192.0.2.9').xffCount).toBe(3);
  });

  it('reports zero when the header is absent', () => {
    expect(shape(undefined)).toEqual({ xffCount: 0, xffSocketIsLast: false });
  });

  it('reports zero for an empty or comma-only header', () => {
    expect(shape('').xffCount).toBe(0);
    expect(shape('  ,  ,').xffCount).toBe(0);
  });

  it('joins a repeated header into one chain', () => {
    expect(shape(['203.0.113.7', '198.51.100.4, 192.0.2.9']).xffCount).toBe(3);
  });

  it('is true when the socket peer is the last chain entry', () => {
    expect(shape('203.0.113.7, 198.51.100.4', '198.51.100.4')).toEqual({
      xffCount: 2,
      xffSocketIsLast: true,
    });
  });

  it('is false when the socket peer is not the last chain entry', () => {
    expect(
      shape('203.0.113.7, 198.51.100.4', '192.0.2.9').xffSocketIsLast,
    ).toBe(false);
  });

  it('treats an IPv4-mapped IPv6 socket as equal to its IPv4 form', () => {
    expect(
      shape('203.0.113.7, 198.51.100.4', '::ffff:198.51.100.4').xffSocketIsLast,
    ).toBe(true);
  });

  it('is false when the socket address is unavailable', () => {
    expect(shape('203.0.113.7').xffSocketIsLast).toBe(false);
  });
});

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let logged: string[];

  const context = (
    request: Record<string, unknown>,
    statusCode = 200,
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ statusCode }),
      }),
    }) as unknown as ExecutionContext;

  const request = {
    requestId: 'req-1',
    method: 'GET',
    url: '/v1/health',
    headers: { 'x-forwarded-for': '203.0.113.7, 198.51.100.4' },
    socket: { remoteAddress: '198.51.100.4' },
  };

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
    logged = [];
    jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((message: unknown) => {
        logged.push(String(message));
      });
  });

  afterEach(() => jest.restoreAllMocks());

  const run = (ctx: ExecutionContext, handler: CallHandler) =>
    new Promise<void>((resolve) =>
      interceptor
        .intercept(ctx, handler)
        .subscribe({ next: () => resolve(), error: () => resolve() }),
    );

  it('emits the forwarded-chain shape on a successful request', async () => {
    await run(context(request), { handle: () => of({ ok: true }) });

    expect(JSON.parse(logged[0])).toMatchObject({
      requestId: 'req-1',
      method: 'GET',
      path: '/v1/health',
      statusCode: 200,
      xffCount: 2,
      xffSocketIsLast: true,
    });
  });

  it('emits the shape on a failed request too', async () => {
    await run(context(request), {
      handle: () => throwError(() => ({ status: 503 })),
    });

    expect(JSON.parse(logged[0])).toMatchObject({
      statusCode: 503,
      xffCount: 2,
    });
  });

  // The point of the whole change: spec/behavior/observability.md forbids
  // logging IP addresses unconditionally. A future edit that "helpfully"
  // substitutes the raw value for the count must fail here.
  it('never emits an address from the chain or the socket', async () => {
    await run(context(request), { handle: () => of({ ok: true }) });

    expect(logged[0]).not.toContain('203.0.113.7');
    expect(logged[0]).not.toContain('198.51.100.4');
    expect(logged[0]).not.toContain('x-forwarded-for');
  });
});
