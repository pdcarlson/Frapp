import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
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
});
