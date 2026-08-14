import {
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
    expect(setUser).toHaveBeenCalledWith({ id: expect.stringMatching(/^[0-9a-f]{64}$/) });
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
    expect(captured.json).toMatchObject({ statusCode: 401, requestId: 'req-abc' });
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
});
