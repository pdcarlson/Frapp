import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AuthFailureSpikeDetector } from '../../infrastructure/observability/auth-failure-spike';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  withScope: jest.fn((callback: (scope: unknown) => void) =>
    callback({
      setLevel: jest.fn(),
      setTag: jest.fn(),
      setUser: jest.fn(),
    }),
  ),
}));

const SALT = 'filter-spec-salt';
const USER_ID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const CHAPTER_ID = '9e8d7c6b-5a49-4382-b716-05f4e3d2c1b0';
const CLIENT_IP = '203.0.113.42';

interface Captured {
  warn: string[];
  error: string[];
  json: unknown;
  status: number | undefined;
}

/**
 * `AllExceptionsFilter` is the one seam every denial and every 5xx passes
 * through (issues #846, #481), so these tests are the contract for both: the
 * security-event record's shape, and that nothing raw escapes to Sentry.
 */
describe('AllExceptionsFilter', () => {
  const originalSalt = process.env.ANALYTICS_HMAC_SALT;
  let captured: Captured;

  beforeEach(() => {
    process.env.ANALYTICS_HMAC_SALT = SALT;
    jest.clearAllMocks();
    captured = { warn: [], error: [], json: undefined, status: undefined };
    jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((message: unknown) => {
        captured.warn.push(String(message));
      });
    jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((message: unknown) => {
        captured.error.push(String(message));
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (originalSalt === undefined) delete process.env.ANALYTICS_HMAC_SALT;
    else process.env.ANALYTICS_HMAC_SALT = originalSalt;
  });

  function host(overrides: Record<string, unknown> = {}): ArgumentsHost {
    const request = {
      requestId: 'req-abc',
      method: 'POST',
      url: '/v1/chapters/join?invite=secret-code',
      ip: CLIENT_IP,
      ips: [],
      ...overrides,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({
          status: (code: number) => {
            captured.status = code;
            return {
              json: (body: unknown) => {
                captured.json = body;
              },
            };
          },
        }),
      }),
    } as unknown as ArgumentsHost;
  }

  function securityEvents(): Array<Record<string, unknown>> {
    return captured.warn
      .filter((line) => line.includes('security_event'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it.each([
    [new UnauthorizedException(), 401, 'auth_failure'],
    [new ForbiddenException(), 403, 'authorization_denied'],
    [
      new HttpException('Too many', HttpStatus.TOO_MANY_REQUESTS),
      429,
      'rate_limit_rejected',
    ],
  ])('emits a %s security event', (exception, status, kind) => {
    new AllExceptionsFilter().catch(exception, host());

    const [event] = securityEvents();
    expect(event).toMatchObject({
      event: 'security_event',
      kind,
      statusCode: status,
      method: 'POST',
      requestId: 'req-abc',
    });
    expect(captured.status).toBe(status);
  });

  it('never writes the client address, and strips the query string', () => {
    new AllExceptionsFilter().catch(new UnauthorizedException(), host());

    const [event] = securityEvents();
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(CLIENT_IP);
    expect(serialized).not.toContain('secret-code');
    expect(event.path).toBe('/v1/chapters/join');
    // Present, hashed, and stable — that is what the spike rule groups on.
    expect(event.originHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('carries raw user and chapter ids in the internal record', () => {
    // spec/behavior/observability.md keeps these raw in *internal* logs and
    // pseudonymizes only at external boundaries.
    new AllExceptionsFilter().catch(
      new ForbiddenException(),
      host({ appUser: { id: USER_ID }, chapterId: CHAPTER_ID }),
    );

    expect(securityEvents()[0]).toMatchObject({
      userId: USER_ID,
      chapterId: CHAPTER_ID,
    });
  });

  it('omits the origin hash when no salt is configured', () => {
    delete process.env.ANALYTICS_HMAC_SALT;

    new AllExceptionsFilter().catch(new UnauthorizedException(), host());

    const [event] = securityEvents();
    expect(event).not.toHaveProperty('originHash');
    expect(JSON.stringify(event)).not.toContain(CLIENT_IP);
  });

  it('ignores statuses that are not security-relevant', () => {
    new AllExceptionsFilter().catch(new NotFoundException(), host());

    expect(securityEvents()).toHaveLength(0);
    expect(captured.status).toBe(404);
  });

  it('escalates an auth-failure spike to Sentry exactly once', () => {
    const filter = new AllExceptionsFilter(
      new AuthFailureSpikeDetector({ threshold: 3, windowMs: 60_000 }),
    );

    for (let i = 0; i < 6; i++) {
      filter.catch(new UnauthorizedException(), host());
    }

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(jest.mocked(Sentry.captureMessage).mock.calls[0]?.[0]).toContain(
      'Auth failure spike',
    );
    const spike = securityEvents().find((e) => e.kind === 'auth_failure_spike');
    expect(spike).toMatchObject({ count: 3, threshold: 3 });
  });

  it('reports 5xx to Sentry with a pseudonymous user, never the raw id', () => {
    const setUser = jest.fn();
    const setTag = jest.fn();
    jest
      .mocked(Sentry.withScope)
      .mockImplementation((callback: (scope: never) => unknown) =>
        callback({ setLevel: jest.fn(), setTag, setUser } as never),
      );

    new AllExceptionsFilter().catch(
      new Error('database exploded'),
      host({ appUser: { id: USER_ID }, chapterId: CHAPTER_ID }),
    );

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(setUser).toHaveBeenCalledWith({
      id: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(setUser).not.toHaveBeenCalledWith({ id: USER_ID });

    const tags = Object.fromEntries(setTag.mock.calls as [string, string][]);
    expect(tags.chapter).toMatch(/^[0-9a-f]{64}$/);
    expect(tags.chapter).not.toBe(CHAPTER_ID);
    expect(tags.route).toBe('/v1/chapters/join');
    expect(tags.request_id).toBe('req-abc');
    expect(captured.status).toBe(500);
  });

  it('does not report a 4xx to Sentry as an exception', () => {
    new AllExceptionsFilter().catch(new ForbiddenException(), host());
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('still answers the request when observability throws', () => {
    const exploding = {
      record: () => {
        throw new Error('detector broke');
      },
    } as unknown as AuthFailureSpikeDetector;

    new AllExceptionsFilter(exploding).catch(
      new UnauthorizedException(),
      host(),
    );

    expect(captured.status).toBe(401);
    expect(captured.json).toMatchObject({
      statusCode: 401,
      requestId: 'req-abc',
    });
  });

  /**
   * The regression behind FRAPP-API-1.
   *
   * `if (error) throw error` — how roughly two hundred repository methods end —
   * throws a PLAIN OBJECT, because postgrest-js only constructs
   * `PostgrestError` on the `.throwOnError()` path. The filter used to run that
   * through `String()`, so both Sentry and the 5xx log recorded the literal
   * text `[object Object]` and the actual fault was unrecoverable.
   */
  it('reports a thrown PostgREST object legibly, not as [object Object]', () => {
    const postgrestError = {
      code: 'PGRST205',
      details: null,
      hint: null,
      message:
        "Could not find the table 'public.discord_oauth_states' in the schema cache",
    };

    new AllExceptionsFilter().catch(postgrestError, host());

    const [reported] = jest.mocked(Sentry.captureException).mock.calls[0] as [
      Error,
    ];
    expect(reported).toBeInstanceOf(Error);
    expect(reported.message).toContain('PGRST205');
    expect(reported.message).toContain('discord_oauth_states');
    expect(reported.message).not.toContain('[object Object]');

    // The internal log was blinded by the same line and is fixed by the same
    // normalization — asserting one without the other would leave half of it.
    expect(captured.error[0]).toContain('PGRST205');
    expect(captured.error[0]).not.toContain('[object Object]');
  });

  it('keeps the offending row values out of what Sentry receives', () => {
    // `details` is where Postgres puts the values that broke the constraint, so
    // it is the one field of the four that carries member data. The constraint
    // itself is already named in `message`, which is what triage needs.
    new AllExceptionsFilter().catch(
      {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "users_email_key"',
        details: 'Key (email)=(alice@example.com) already exists.',
        hint: null,
      },
      host(),
    );

    const [reported] = jest.mocked(Sentry.captureException).mock.calls[0] as [
      Error,
    ];
    expect(reported.message).toContain('23505');
    expect(reported.message).toContain('users_email_key');
    expect(reported.message).not.toContain('alice@example.com');
  });

  it('names a bare object throw so the missing stack is explainable', () => {
    new AllExceptionsFilter().catch({ message: 'no stack here' }, host());

    const [reported] = jest.mocked(Sentry.captureException).mock.calls[0] as [
      Error,
    ];
    expect(reported.name).toBe('NonErrorThrowable');
    expect(reported.message).toBe('no stack here');
  });

  it('serializes a thrown object carrying none of the known fields', () => {
    new AllExceptionsFilter().catch(
      { statusCode: 502, retryable: true },
      host(),
    );

    const [reported] = jest.mocked(Sentry.captureException).mock.calls[0] as [
      Error,
    ];
    expect(reported.message).toContain('502');
    expect(reported.message).not.toContain('[object Object]');
  });

  it('does not let a circular throwable break reporting', () => {
    const circular: Record<string, unknown> = { kind: 'weird' };
    circular.self = circular;

    expect(() =>
      new AllExceptionsFilter().catch(circular, host()),
    ).not.toThrow();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(captured.status).toBe(500);
  });

  it('passes a real Error through untouched', () => {
    const thrown = new Error('boom');
    new AllExceptionsFilter().catch(thrown, host());

    const [reported] = jest.mocked(Sentry.captureException).mock.calls[0] as [
      Error,
    ];
    expect(reported).toBe(thrown);
  });

  it('strips the query string from the 5xx error log (#1260)', () => {
    // The shared fixture URL is `/v1/chapters/join?invite=secret-code`, so the
    // query already carries a credential-shaped value. This log line runs at
    // `error` level, which ships in every environment.
    new AllExceptionsFilter().catch(new Error('boom'), host());

    expect(captured.error[0]).not.toContain('secret-code');
    expect(captured.error[0]).not.toContain('?');

    // ...and the path itself survives, so the record still identifies the route.
    const logged = JSON.parse(captured.error[0] ?? '{}') as Record<
      string,
      unknown
    >;
    expect(logged).toMatchObject({ path: '/v1/chapters/join' });
  });

  it('strips the OAuth state and code from the 5xx error log (#1260)', () => {
    new AllExceptionsFilter().catch(
      new Error('boom'),
      host({ url: '/v1/discord/connect/callback?code=abc123&state=deadbeef' }),
    );

    expect(captured.error[0]).not.toContain('deadbeef');
    expect(captured.error[0]).not.toContain('abc123');
  });

  it('preserves the existing 5xx error log shape', () => {
    new AllExceptionsFilter().catch(new Error('boom'), host());

    const logged = JSON.parse(captured.error[0] ?? '{}') as Record<
      string,
      unknown
    >;
    expect(logged).toMatchObject({
      requestId: 'req-abc',
      method: 'POST',
      statusCode: 500,
    });
    expect(String(logged.error)).toContain('boom');
  });

  describe('response body contract (#1020)', () => {
    it('serialises exactly four keys, and `code` is not one of them', () => {
      // The guard vocabulary in chapter.guard.ts throws `{ code, message }`.
      // Only the message survives today. This pins that, so exposing `code`
      // becomes a deliberate edit here rather than a silent contract change.
      new AllExceptionsFilter().catch(
        new ForbiddenException({
          code: 'chapter.context.mismatch',
          message: 'The x-chapter-id header disagrees with your token.',
        }),
        host(),
      );

      const body = captured.json as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual([
        'error',
        'message',
        'requestId',
        'statusCode',
      ]);
      expect(body.code).toBeUndefined();
      expect(body.message).toBe(
        'The x-chapter-id header disagrees with your token.',
      );
    });

    it('preserves a ValidationPipe message array instead of flattening it', () => {
      // ValidationPipe builds `message` as an array, which makes Nest's own
      // `initMessage()` fall back to the humanized class name. Reading
      // `exception.message` therefore turned every field error in the product
      // into the literal string "Bad Request Exception".
      new AllExceptionsFilter().catch(
        new BadRequestException({
          statusCode: 400,
          message: ['chapter_id should not exist', 'points must be a number'],
          error: 'Bad Request',
        }),
        host(),
      );

      const body = captured.json as Record<string, unknown>;
      expect(body.message).toEqual([
        'chapter_id should not exist',
        'points must be a number',
      ]);
    });

    it('passes a plain string message through unchanged', () => {
      new AllExceptionsFilter().catch(
        new NotFoundException('No such chapter'),
        host(),
      );

      expect((captured.json as Record<string, unknown>).message).toBe(
        'No such chapter',
      );
    });
  });
});
