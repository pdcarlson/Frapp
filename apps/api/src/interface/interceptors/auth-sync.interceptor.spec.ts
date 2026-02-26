import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { AuthSyncInterceptor } from './auth-sync.interceptor';
import { AuthService } from '../../application/services/auth.service';

describe('AuthSyncInterceptor', () => {
  let interceptor: AuthSyncInterceptor;
  let mockAuthService: jest.Mocked<Pick<AuthService, 'syncUser'>>;

  const mockCallHandler: CallHandler = {
    handle: () => of({ result: 'ok' }),
  };

  const mockExecutionContext = (supabaseUser?: { id: string; email: string }): ExecutionContext => {
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
        AuthSyncInterceptor,
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    interceptor = module.get(AuthSyncInterceptor);
  });

  it('should sync user and set appUser on request', async () => {
    mockAuthService.syncUser.mockResolvedValue({ id: 'user-1' });

    const ctx = mockExecutionContext({ id: 'auth-123', email: 'test@example.com' });
    const result$ = await interceptor.intercept(ctx, mockCallHandler);

    const request = ctx.switchToHttp().getRequest() as Record<string, unknown>;
    expect(request.appUser).toEqual({ id: 'user-1' });
    expect(mockAuthService.syncUser).toHaveBeenCalledWith('auth-123', 'test@example.com');

    await new Promise<void>((resolve) => {
      result$.subscribe({ complete: resolve });
    });
  });

  it('should not sync when supabaseUser is not set', async () => {
    const ctx = mockExecutionContext(undefined);
    const result$ = await interceptor.intercept(ctx, mockCallHandler);

    const request = ctx.switchToHttp().getRequest() as Record<string, unknown>;
    expect(request.appUser).toBeUndefined();
    expect(mockAuthService.syncUser).not.toHaveBeenCalled();

    await new Promise<void>((resolve) => {
      result$.subscribe({ complete: resolve });
    });
  });

  it('should use empty string for email when supabaseUser email is null', async () => {
    mockAuthService.syncUser.mockResolvedValue({ id: 'user-2' });

    const ctx = mockExecutionContext({ id: 'auth-456', email: undefined as unknown as string });
    const result$ = await interceptor.intercept(ctx, mockCallHandler);

    expect(mockAuthService.syncUser).toHaveBeenCalledWith('auth-456', '');

    await new Promise<void>((resolve) => {
      result$.subscribe({ complete: resolve });
    });
  });
});
