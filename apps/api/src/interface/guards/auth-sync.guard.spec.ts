import { ExecutionContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthSyncGuard } from './auth-sync.guard';
import { AuthService } from '../../application/services/auth.service';

describe('AuthSyncGuard', () => {
  let guard: AuthSyncGuard;
  let mockAuthService: jest.Mocked<Pick<AuthService, 'syncUser'>>;

  const mockExecutionContext = (supabaseUser?: {
    id: string;
    email: string | null | undefined;
  }): ExecutionContext => {
    const request = { supabaseUser, appUser: undefined as unknown };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    mockAuthService = {
      syncUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthSyncGuard,
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    guard = module.get(AuthSyncGuard);
  });

  it('should sync user and set appUser on request', async () => {
    mockAuthService.syncUser.mockResolvedValue({ id: 'user-1' });

    const ctx = mockExecutionContext({
      id: 'auth-123',
      email: 'test@example.com',
    });
    await guard.canActivate(ctx);

    const request = ctx.switchToHttp().getRequest();
    expect(request.appUser).toEqual({ id: 'user-1' });
    expect(mockAuthService.syncUser).toHaveBeenCalledWith(
      'auth-123',
      'test@example.com',
    );
  });

  it('should not sync when supabaseUser is not set', async () => {
    const ctx = mockExecutionContext(undefined);
    await guard.canActivate(ctx);

    const request = ctx.switchToHttp().getRequest();
    expect(request.appUser).toBeUndefined();
    expect(mockAuthService.syncUser).not.toHaveBeenCalled();
  });

  it('should use empty string for email when supabaseUser email is null', async () => {
    mockAuthService.syncUser.mockResolvedValue({ id: 'user-2' });

    const ctx = mockExecutionContext({ id: 'auth-456', email: null });
    await guard.canActivate(ctx);

    expect(mockAuthService.syncUser).toHaveBeenCalledWith('auth-456', '');
  });
});
