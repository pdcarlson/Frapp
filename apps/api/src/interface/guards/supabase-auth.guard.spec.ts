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
import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

describe('SupabaseAuthGuard', () => {
  let guard: SupabaseAuthGuard;
  let mockGetUser: jest.Mock;
  let mockGetClaims: jest.Mock;

  const mockExecutionContext = (
    headers: Record<string, string> = {},
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
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    mockGetUser = jest.fn();
    mockGetClaims = jest.fn().mockResolvedValue({ data: null, error: null });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupabaseAuthGuard,
        {
          provide: SUPABASE_CLIENT,
          useValue: {
            auth: { getUser: mockGetUser, getClaims: mockGetClaims },
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
  describe('requests arriving together (#3728)', () => {
    it('shares one getUser call between concurrent requests with the same token', async () => {
      let release!: (value: unknown) => void;
      mockGetUser.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      const first = mockExecutionContext({ authorization: 'Bearer burst' });
      const second = mockExecutionContext({ authorization: 'Bearer burst' });

      const results = Promise.all([
        guard.canActivate(first),
        guard.canActivate(second),
      ]);
      release({ data: { user: { id: 'auth-123' } }, error: null });

      await expect(results).resolves.toEqual([true, true]);
      expect(mockGetUser).toHaveBeenCalledTimes(1);
      const firstUser = first.switchToHttp().getRequest().supabaseUser;
      const secondUser = second.switchToHttp().getRequest().supabaseUser;
      expect(firstUser).toEqual({ id: 'auth-123' });
      expect(secondUser).toEqual({ id: 'auth-123' });
      // Each request owns its copy; one handler's edit can't reach another.
      expect(firstUser).not.toBe(secondUser);
    });

    it('checks the token again for a request that starts after the call settled', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'auth-123' } },
        error: null,
      });
      await guard.canActivate(
        mockExecutionContext({ authorization: 'Bearer again' }),
      );
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: new Error('session revoked'),
      });

      await expect(
        guard.canActivate(
          mockExecutionContext({ authorization: 'Bearer again' }),
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockGetUser).toHaveBeenCalledTimes(2);
    });

    it('does not share a call between different tokens', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'auth-123' } },
        error: null,
      });
      await Promise.all([
        guard.canActivate(mockExecutionContext({ authorization: 'Bearer a' })),
        guard.canActivate(mockExecutionContext({ authorization: 'Bearer b' })),
      ]);
      expect(mockGetUser).toHaveBeenCalledTimes(2);
    });
  });
});
