import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { AuthSyncInterceptor } from './auth-sync.interceptor';
import { AuthService } from '../../application/services/auth.service';
import { TimeZoneSyncService } from '../../application/services/time-zone-sync.service';

describe('AuthSyncInterceptor', () => {
  let interceptor: AuthSyncInterceptor;
  let mockAuthService: jest.Mocked<Pick<AuthService, 'syncUser'>>;
  let mockTimeZones: jest.Mocked<Pick<TimeZoneSyncService, 'record'>>;

  const mockCallHandler: CallHandler = {
    handle: () => of({ result: 'ok' }),
  };

  const mockExecutionContext = (
    supabaseUser?: {
      id: string;
      email: string | null | undefined;
      user_metadata?: Record<string, unknown>;
    },
    appUser?: { id: string },
  ): ExecutionContext => {
    const request = {
      supabaseUser,
      appUser: appUser as unknown,
      headers: { 'x-time-zone': 'America/Chicago' },
    };
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
    mockTimeZones = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthSyncInterceptor,
        { provide: AuthService, useValue: mockAuthService },
        { provide: TimeZoneSyncService, useValue: mockTimeZones },
      ],
    }).compile();

    interceptor = module.get(AuthSyncInterceptor);
  });

  it('should sync user and set appUser on request', async () => {
    mockAuthService.syncUser.mockResolvedValue({ id: 'user-1' });

    const ctx = mockExecutionContext({
      id: 'auth-123',
      email: 'test@example.com',
    });
    const result$ = await interceptor.intercept(ctx, mockCallHandler);

    const request = ctx.switchToHttp().getRequest();
    expect(request.appUser).toEqual({ id: 'user-1' });
    expect(mockTimeZones.record).toHaveBeenCalledWith(
      'user-1',
      'America/Chicago',
    );
    expect(mockAuthService.syncUser).toHaveBeenCalledWith(
      'auth-123',
      'test@example.com',
      undefined,
    );

    await new Promise<void>((resolve) => {
      result$.subscribe({ complete: resolve });
    });
  });

  it('should not sync when supabaseUser is not set', async () => {
    const ctx = mockExecutionContext(undefined);
    const result$ = await interceptor.intercept(ctx, mockCallHandler);

    const request = ctx.switchToHttp().getRequest();
    expect(request.appUser).toBeUndefined();
    expect(mockAuthService.syncUser).not.toHaveBeenCalled();

    await new Promise<void>((resolve) => {
      result$.subscribe({ complete: resolve });
    });
  });

  it('should use empty string for email when supabaseUser email is null', async () => {
    mockAuthService.syncUser.mockResolvedValue({ id: 'user-2' });

    const ctx = mockExecutionContext({ id: 'auth-456', email: null });
    const result$ = await interceptor.intercept(ctx, mockCallHandler);

    expect(mockAuthService.syncUser).toHaveBeenCalledWith(
      'auth-456',
      '',
      undefined,
    );

    await new Promise<void>((resolve) => {
      result$.subscribe({ complete: resolve });
    });
  });

  it('forwards Auth user_metadata so Apple/Google names survive sync', async () => {
    mockAuthService.syncUser.mockResolvedValue({ id: 'user-3' });

    const ctx = mockExecutionContext({
      id: 'auth-789',
      email: 'n@privaterelay.appleid.com',
      user_metadata: { full_name: 'Ada Lovelace' },
    });
    await interceptor.intercept(ctx, mockCallHandler);

    expect(mockAuthService.syncUser).toHaveBeenCalledWith(
      'auth-789',
      'n@privaterelay.appleid.com',
      { full_name: 'Ada Lovelace' },
    );
  });

  describe('when a guard already resolved the users row', () => {
    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

    it("keeps the guard's id and does not wait on the sync", async () => {
      let finish: (value: { id: string }) => void = () => undefined;
      mockAuthService.syncUser.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );

      const ctx = mockExecutionContext(
        { id: 'auth-1', email: 'a@example.com' },
        { id: 'user-1' },
      );
      await interceptor.intercept(ctx, mockCallHandler);

      const request = ctx.switchToHttp().getRequest();
      expect(request.appUser).toEqual({ id: 'user-1' });
      expect(mockAuthService.syncUser).toHaveBeenCalledWith(
        'auth-1',
        'a@example.com',
        undefined,
      );
      expect(mockTimeZones.record).toHaveBeenCalledWith(
        'user-1',
        'America/Chicago',
      );
      finish({ id: 'user-1' });
    });

    it('syncs a session once while its email and metadata stay the same', async () => {
      mockAuthService.syncUser.mockResolvedValue({ id: 'user-1' });
      const session = { id: 'auth-1', email: 'a@example.com' };

      await interceptor.intercept(
        mockExecutionContext(session, { id: 'user-1' }),
        mockCallHandler,
      );
      await flush();
      await interceptor.intercept(
        mockExecutionContext(session, { id: 'user-1' }),
        mockCallHandler,
      );

      expect(mockAuthService.syncUser).toHaveBeenCalledTimes(1);
    });

    it("syncs again when the session's email changes", async () => {
      mockAuthService.syncUser.mockResolvedValue({ id: 'user-1' });

      await interceptor.intercept(
        mockExecutionContext(
          { id: 'auth-1', email: 'a@example.com' },
          { id: 'user-1' },
        ),
        mockCallHandler,
      );
      await flush();
      await interceptor.intercept(
        mockExecutionContext(
          { id: 'auth-1', email: 'b@example.com' },
          { id: 'user-1' },
        ),
        mockCallHandler,
      );

      expect(mockAuthService.syncUser).toHaveBeenCalledTimes(2);
      expect(mockAuthService.syncUser).toHaveBeenLastCalledWith(
        'auth-1',
        'b@example.com',
        undefined,
      );
    });

    it('tries again on the next request after a failed sync', async () => {
      mockAuthService.syncUser
        .mockRejectedValueOnce(new Error('pool timeout'))
        .mockResolvedValue({ id: 'user-1' });
      const session = { id: 'auth-1', email: 'a@example.com' };

      await interceptor.intercept(
        mockExecutionContext(session, { id: 'user-1' }),
        mockCallHandler,
      );
      await flush();
      await interceptor.intercept(
        mockExecutionContext(session, { id: 'user-1' }),
        mockCallHandler,
      );

      expect(mockAuthService.syncUser).toHaveBeenCalledTimes(2);
    });

    it('skips the background sync after a waited sync of the same session', async () => {
      mockAuthService.syncUser.mockResolvedValue({ id: 'user-1' });
      const session = { id: 'auth-1', email: 'a@example.com' };

      await interceptor.intercept(
        mockExecutionContext(session),
        mockCallHandler,
      );
      await interceptor.intercept(
        mockExecutionContext(session, { id: 'user-1' }),
        mockCallHandler,
      );

      expect(mockAuthService.syncUser).toHaveBeenCalledTimes(1);
    });
  });
});
