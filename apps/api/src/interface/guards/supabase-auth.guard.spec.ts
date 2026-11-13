import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
} from '@supabase/supabase-js';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { ChapterGuard } from './chapter.guard';
import { runWithRequestReads } from '../../infrastructure/supabase/request-reads';
import { AuthRejectedException } from './auth-rejected.exception';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

describe('SupabaseAuthGuard', () => {
  let guard: SupabaseAuthGuard;
  let mockGetUser: jest.Mock;
  let mockGetClaims: jest.Mock;
  let mockFrom: jest.Mock;
  let mockRpc: jest.Mock;

  /** A route guarded by this guard alone, as `GET /v1/users/me` is. */
  class AuthOnlyController {}
  Reflect.defineMetadata(
    GUARDS_METADATA,
    [SupabaseAuthGuard],
    AuthOnlyController,
  );

  /** A chapter route with no permission check, as attendance check-in is. */
  class ChapterController {}
  Reflect.defineMetadata(
    GUARDS_METADATA,
    [SupabaseAuthGuard, ChapterGuard],
    ChapterController,
  );

  const mockExecutionContext = (
    headers: Record<string, string> = {},
    controller: new () => unknown = AuthOnlyController,
  ): ExecutionContext => {
    const request = {
      headers,
      supabaseUser: undefined as unknown,
      jwtClaims: undefined as unknown,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => () => undefined,
      getClass: () => controller,
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    mockGetUser = jest.fn();
    mockGetClaims = jest.fn().mockResolvedValue({ data: null, error: null });
    // Only the chapter-context prefetch reads tables; it never settles here,
    // which is all these cases need to see whether it started.
    mockFrom = jest.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.in = () => chain;
      chain.maybeSingle = () => new Promise(() => undefined);
      return chain;
    });
    mockRpc = jest.fn(() => new Promise(() => undefined));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupabaseAuthGuard,
        {
          provide: SUPABASE_CLIENT,
          useValue: {
            auth: { getUser: mockGetUser, getClaims: mockGetClaims },
            from: mockFrom,
            rpc: mockRpc,
          },
        },
      ],
    }).compile();

    guard = module.get(SupabaseAuthGuard);
  });

  it('should throw UnauthorizedException when no authorization header', async () => {
    const ctx = mockExecutionContext({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when header is not Bearer', async () => {
    const ctx = mockExecutionContext({ authorization: 'Basic abc123' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when token is invalid', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new Error('invalid'),
    });
    const ctx = mockExecutionContext({ authorization: 'Bearer bad-token' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  describe('names its 401 (#3907)', () => {
    /** An unsigned JWT-shaped token whose payload carries only `exp`. */
    function tokenExpiringAt(expSeconds: number): string {
      const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString(
        'base64url',
      );
      return `e30.${payload}.sig`;
    }

    async function refusal(
      headers: Record<string, string>,
    ): Promise<AuthRejectedException> {
      const thrown: unknown = await guard
        .canActivate(mockExecutionContext(headers))
        .catch((error: unknown) => error);
      expect(thrown).toBeInstanceOf(AuthRejectedException);
      return thrown as AuthRejectedException;
    }

    it.each([
      ['no header', {}],
      ['a non-Bearer header', { authorization: 'Basic abc123' }],
    ])('says no_bearer for %s', async (_label, headers) => {
      const { detail } = await refusal(headers);
      expect(detail).toEqual({ reason: 'no_bearer' });
      expect(mockGetUser).not.toHaveBeenCalled();
    });

    it('says token_rejected with Auth code and expiry for a stale token', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: new AuthApiError('JWT expired', 403, 'bad_jwt'),
      });
      const stale = tokenExpiringAt(Math.floor(Date.now() / 1000) - 60);

      const error = await refusal({ authorization: `Bearer ${stale}` });
      expect(error.detail).toEqual({
        reason: 'token_rejected',
        authErrorCode: 'bad_jwt',
        tokenExpired: true,
      });
      expect(error.getResponse()).toMatchObject({
        message: 'Invalid or expired token',
      });
      expect(JSON.stringify(error.detail)).not.toContain(stale);
    });

    it('marks an unexpired refused token as not expired', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: new AuthApiError('Session not found', 403, 'session_not_found'),
      });
      const live = tokenExpiringAt(Math.floor(Date.now() / 1000) + 600);

      const { detail } = await refusal({ authorization: `Bearer ${live}` });
      expect(detail).toEqual({
        reason: 'token_rejected',
        authErrorCode: 'session_not_found',
        tokenExpired: false,
      });
    });

    it('drops an unreadable token expiry and a free-text error code', async () => {
      const error = Object.assign(new Error('nope'), {
        code: 'Not A Code <script>',
      });
      mockGetUser.mockResolvedValue({ data: { user: null }, error });

      const { detail } = await refusal({ authorization: 'Bearer bad-token' });
      expect(detail).toEqual({
        reason: 'token_rejected',
        authErrorCode: undefined,
        tokenExpired: undefined,
      });
    });
  });

  it('should set supabaseUser on request when token is valid', async () => {
    const fakeUser = { id: 'auth-123', email: 'test@example.com' };
    mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });

    const ctx = mockExecutionContext({ authorization: 'Bearer valid-token' });
    const result = await guard.canActivate(ctx);
    const request = ctx.switchToHttp().getRequest();

    expect(result).toBe(true);
    expect(request.supabaseUser).toEqual(fakeUser);
    expect(mockGetUser).toHaveBeenCalledWith('valid-token');
  });

  // `getUser()` returns the database user record, so the active-chapter claim
  // written by `custom_access_token_hook` can only come off the token itself.
  describe('access-token claims', () => {
    const validUser = () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'auth-123', email: 'test@example.com' } },
        error: null,
      });
    };

    it('exposes verified token claims on the request', async () => {
      validUser();
      mockGetClaims.mockResolvedValue({
        data: { claims: { sub: 'auth-123', active_chapter_id: 'chapter-1' } },
        error: null,
      });

      const ctx = mockExecutionContext({ authorization: 'Bearer valid-token' });
      await guard.canActivate(ctx);

      expect(mockGetClaims).toHaveBeenCalledWith('valid-token');
      expect(ctx.switchToHttp().getRequest().jwtClaims).toEqual({
        sub: 'auth-123',
        active_chapter_id: 'chapter-1',
      });
    });

    it('still authenticates when claims cannot be verified', async () => {
      validUser();
      mockGetClaims.mockResolvedValue({
        data: null,
        error: new Error('jwks unreachable'),
      });

      const ctx = mockExecutionContext({ authorization: 'Bearer valid-token' });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(ctx.switchToHttp().getRequest().jwtClaims).toBeUndefined();
    });

    it('does not reject the request when getClaims throws', async () => {
      validUser();
      mockGetClaims.mockRejectedValue(new Error('boom'));

      const ctx = mockExecutionContext({ authorization: 'Bearer valid-token' });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(ctx.switchToHttp().getRequest().jwtClaims).toBeUndefined();
    });
  });
  // #3143: an Auth outage is not a verdict on the token. A 401 reads to the
  // client as "signed out" and is never retried; a 503 is.
  describe('an Auth outage is a 503, an invalid token stays a 401', () => {
    const bearer = () => mockExecutionContext({ authorization: 'Bearer tok' });

    it.each([
      ['a dropped connection', new AuthRetryableFetchError('fetch failed', 0)],
      ['an Auth 5xx', new AuthRetryableFetchError('Bad Gateway', 502)],
      [
        'an Auth 500 with a JSON body',
        new AuthApiError('boom', 500, undefined),
      ],
      [
        'Auth rate limiting',
        new AuthApiError('Too many', 429, 'over_request_rate_limit'),
      ],
    ])(
      'answers 503 for %s, with the error as its cause',
      async (_label, error) => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error });
        const thrown = await guard
          .canActivate(bearer())
          .catch((e: unknown) => e);
        expect(thrown).toBeInstanceOf(ServiceUnavailableException);
        expect((thrown as Error).cause).toBe(error);
      },
    );

    it.each([
      ['an expired token', new AuthApiError('JWT expired', 403, 'bad_jwt')],
      ['a malformed token', new AuthApiError('invalid JWT', 401, 'bad_jwt')],
      [
        'a deleted user',
        new AuthApiError('User not found', 404, 'user_not_found'),
      ],
      ['an error auth-js builds itself', new AuthSessionMissingError()],
      [
        'an unreadable non-5xx answer',
        new AuthUnknownError('Unexpected token <', null),
      ],
    ])('keeps 401 for %s', async (_label, error) => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error });
      await expect(guard.canActivate(bearer())).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
  // The session check is the slowest call a request makes; the chapter
  // guard's reads start while it is in flight, on the sub the throttler
  // already verified (`request.throttlerVerifiedClaims`).
  describe('chapter lookups overlap the session check (#3728)', () => {
    const CHAPTER = '33333333-3333-4333-8333-333333333333';
    // A fresh sub per case: the user lookup is shared across requests for
    // `IN_FLIGHT_JOIN_WINDOW_MS` (#3753), and these mocks never settle, so a
    // reused sub would join the previous case's read instead of starting one.
    let claims: { sub: string; active_chapter_id: string };
    let caseNo = 0;
    beforeEach(() => {
      caseNo += 1;
      claims = { sub: `auth-overlap-${caseNo}`, active_chapter_id: CHAPTER };
    });

    const pendingSession = () => {
      let release!: (value: unknown) => void;
      mockGetUser.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      return (user: { id: string } | null) =>
        release(
          user
            ? { data: { user }, error: null }
            : { data: { user: null }, error: new Error('session revoked') },
        );
    };

    /** A context whose request carries what the throttler verified, if anything. */
    const contextWith = (
      verified: object | undefined,
      controller: new () => unknown,
    ) => {
      const ctx = mockExecutionContext(
        { authorization: 'Bearer valid-token' },
        controller,
      );
      const request = ctx.switchToHttp().getRequest<Record<string, unknown>>();
      request.throttlerVerifiedClaims = verified;
      return ctx;
    };

    const settle = () => new Promise((resolve) => setImmediate(resolve));

    it('starts them before getUser answers, on a chapter route', async () => {
      const answer = pendingSession();
      const ctx = contextWith(claims, ChapterController);

      await runWithRequestReads('GET', async () => {
        const verdict = guard.canActivate(ctx);
        await settle();
        // One call for the user, chapter, membership and roles (#3583).
        expect(mockRpc).toHaveBeenCalledWith('get_request_context', {
          p_auth_id: claims.sub,
          p_chapter_id: CHAPTER,
        });
        expect(mockFrom).not.toHaveBeenCalled();

        answer({ id: claims.sub });
        await expect(verdict).resolves.toBe(true);
      });
    });

    it('verifies no token itself: getClaims still runs only after getUser accepted it', async () => {
      const answer = pendingSession();
      const ctx = contextWith(claims, ChapterController);

      await runWithRequestReads('GET', async () => {
        const verdict = guard.canActivate(ctx);
        await settle();
        expect(mockGetClaims).not.toHaveBeenCalled();
        answer({ id: claims.sub });
        await verdict;
      });
      expect(mockGetClaims).toHaveBeenCalledTimes(1);
    });

    it('starts nothing on a route without ChapterGuard', async () => {
      const answer = pendingSession();

      await runWithRequestReads('GET', async () => {
        const verdict = guard.canActivate(
          contextWith(claims, AuthOnlyController),
        );
        await settle();
        answer({ id: claims.sub });
        await verdict;
      });
      expect(mockFrom).not.toHaveBeenCalled();
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('starts nothing when the throttler verified nothing', async () => {
      const answer = pendingSession();

      await runWithRequestReads('GET', async () => {
        const verdict = guard.canActivate(
          contextWith(undefined, ChapterController),
        );
        await settle();
        answer({ id: 'auth-123' });
        await verdict;
      });
      expect(mockFrom).not.toHaveBeenCalled();
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('still refuses a revoked session whose lookups already started', async () => {
      const answer = pendingSession();
      const ctx = contextWith(claims, ChapterController);

      await runWithRequestReads('GET', async () => {
        const verdict = guard.canActivate(ctx);
        await settle();
        expect(mockRpc).toHaveBeenCalled();
        answer(null);
        await expect(verdict).rejects.toThrow(UnauthorizedException);
      });
      expect(ctx.switchToHttp().getRequest().supabaseUser).toBeUndefined();
      expect(ctx.switchToHttp().getRequest().jwtClaims).toBeUndefined();
    });
  });

  // An app open sends dozens of requests at once with one token and chapter.
  // Paul accepted sharing their checks within IN_FLIGHT_JOIN_WINDOW_MS
  // (#3752, 2026-11-13); these pin what is shared and under which key.
  describe("shares a burst's checks (#3752)", () => {
    const CHAPTER_A = '44444444-4444-4444-8444-444444444444';
    const CHAPTER_B = '55555555-5555-4555-8555-555555555555';
    let caseNo = 0;
    let token: string;
    let sub: string;
    beforeEach(() => {
      caseNo += 1;
      token = `burst-token-${caseNo}`;
      sub = `auth-burst-${caseNo}`;
    });

    const inGet = <T>(fn: () => T): T => runWithRequestReads('GET', fn);
    const request = (
      bearer: string,
      controller: new () => unknown = AuthOnlyController,
      verified?: object,
    ) => {
      const ctx = mockExecutionContext(
        { authorization: `Bearer ${bearer}` },
        controller,
      );
      const req = ctx.switchToHttp().getRequest<Record<string, unknown>>();
      req.throttlerVerifiedClaims = verified;
      return ctx;
    };

    it('makes one session check for requests that arrive together with one token', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: sub } },
        error: null,
      });
      const first = request(token);
      const second = request(token);

      await Promise.all([
        inGet(() => guard.canActivate(first)),
        inGet(() => guard.canActivate(second)),
      ]);

      expect(mockGetUser).toHaveBeenCalledTimes(1);
      const a = first.switchToHttp().getRequest().supabaseUser;
      const b = second.switchToHttp().getRequest().supabaseUser;
      expect(a).toEqual({ id: sub });
      expect(b).toEqual({ id: sub });
      // Each request gets its own copy of the shared answer.
      expect(a).not.toBe(b);
    });

    it('checks each token on its own', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: sub } },
        error: null,
      });

      await Promise.all([
        inGet(() => guard.canActivate(request(token))),
        inGet(() => guard.canActivate(request(`${token}-other`))),
      ]);

      expect(mockGetUser).toHaveBeenCalledTimes(2);
    });

    it('checks the session itself in a request that may write', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: sub } },
        error: null,
      });

      await Promise.all([
        inGet(() => guard.canActivate(request(token))),
        runWithRequestReads('POST', () => guard.canActivate(request(token))),
      ]);

      expect(mockGetUser).toHaveBeenCalledTimes(2);
    });

    it('refuses every request that joined a rejected session check', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: new Error('session revoked'),
      });

      const verdicts = await Promise.allSettled([
        inGet(() => guard.canActivate(request(token))),
        inGet(() => guard.canActivate(request(token))),
      ]);

      expect(mockGetUser).toHaveBeenCalledTimes(1);
      for (const verdict of verdicts) {
        expect(verdict.status).toBe('rejected');
      }
    });

    it('makes one request-context call per user and chapter', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: sub } },
        error: null,
      });
      const inChapter = (chapter: string, method = 'GET') =>
        runWithRequestReads(method, () =>
          guard.canActivate(
            request(token, ChapterController, {
              sub,
              active_chapter_id: chapter,
            }),
          ),
        );

      await Promise.all([
        inChapter(CHAPTER_A),
        inChapter(CHAPTER_A),
        inChapter(CHAPTER_B),
        // A request that may write makes its own call.
        inChapter(CHAPTER_B, 'PATCH'),
      ]);

      const calls = mockRpc.mock.calls.filter(
        ([name]) => name === 'get_request_context',
      );
      expect(calls).toEqual([
        ['get_request_context', { p_auth_id: sub, p_chapter_id: CHAPTER_A }],
        ['get_request_context', { p_auth_id: sub, p_chapter_id: CHAPTER_B }],
        ['get_request_context', { p_auth_id: sub, p_chapter_id: CHAPTER_B }],
      ]);
    });
  });
});
