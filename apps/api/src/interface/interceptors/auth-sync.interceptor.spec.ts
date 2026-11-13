import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { AuthSyncInterceptor } from './auth-sync.interceptor';
import { AuthService } from '../../application/services/auth.service';
import { TimeZoneSyncService } from '../../application/services/time-zone-sync.service';

describe('AuthSyncInterceptor', () => {
  // The memo is process-wide, so every case uses its own sessions.
  let caseNo = 0;
  let auth: (name: string) => string;
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
    caseNo += 1;
    auth = (name) => `${name}-case-${caseNo}`;
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
      id: auth('auth-123'),
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
      auth('auth-123'),
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

    const ctx = mockExecutionContext({ id: auth('auth-456'), email: null });
    const result$ = await interceptor.intercept(ctx, mockCallHandler);

    expect(mockAuthService.syncUser).toHaveBeenCalledWith(
      auth('auth-456'),
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
      id: auth('auth-789'),
      email: 'n@privaterelay.appleid.com',
      user_metadata: { full_name: 'Ada Lovelace' },
    });
    await interceptor.intercept(ctx, mockCallHandler);

    expect(mockAuthService.syncUser).toHaveBeenCalledWith(
      auth('auth-789'),
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
        { id: auth('auth-1'), email: 'a@example.com' },
        { id: 'user-1' },
      );
      await interceptor.intercept(ctx, mockCallHandler);

      const request = ctx.switchToHttp().getRequest();
      expect(request.appUser).toEqual({ id: 'user-1' });
      expect(mockAuthService.syncUser).toHaveBeenCalledWith(
        auth('auth-1'),
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
      const session = { id: auth('auth-1'), email: 'a@example.com' };

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

    it("waits on a fresh sync when the session's email changes", async () => {
      mockAuthService.syncUser.mockResolvedValue({ id: 'user-1' });

      await interceptor.intercept(
        mockExecutionContext(
          { id: auth('auth-1'), email: 'a@example.com' },
          { id: 'user-1' },
        ),
        mockCallHandler,
      );
      await flush();
      await interceptor.intercept(
        mockExecutionContext(
          { id: auth('auth-1'), email: 'b@example.com' },
          { id: 'user-1' },
        ),
        mockCallHandler,
      );

      expect(mockAuthService.syncUser).toHaveBeenCalledTimes(2);
      expect(mockAuthService.syncUser).toHaveBeenLastCalledWith(
        auth('auth-1'),
        'b@example.com',
        undefined,
      );
    });

    it('tries again on the next request after a failed sync', async () => {
      mockAuthService.syncUser
        .mockRejectedValueOnce(new Error('pool timeout'))
        .mockResolvedValue({ id: 'user-1' });
      const session = { id: auth('auth-1'), email: 'a@example.com' };

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
      const session = { id: auth('auth-1'), email: 'a@example.com' };

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

    it('waits on a fresh sync when only the metadata changes', async () => {
      mockAuthService.syncUser.mockResolvedValue({ id: 'user-1' });
      const id = auth('auth-apple');
      const email = 'n@privaterelay.appleid.com';

      await interceptor.intercept(
        mockExecutionContext({ id, email }, { id: 'user-1' }),
        mockCallHandler,
      );
      await flush();
      // The Apple name reaches the Auth metadata after the row was created.
      let finish: (value: { id: string }) => void = () => undefined;
      mockAuthService.syncUser.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const waited = interceptor.intercept(
        mockExecutionContext(
          { id, email, user_metadata: { full_name: 'Ada Lovelace' } },
          { id: 'user-1' },
        ),
        mockCallHandler,
      );
      let settled = false;
      void waited.then(() => {
        settled = true;
      });
      await flush();

      expect(settled).toBe(false);
      expect(mockAuthService.syncUser).toHaveBeenLastCalledWith(id, email, {
        full_name: 'Ada Lovelace',
      });
      finish({ id: 'user-1' });
      await waited;
      expect(mockAuthService.syncUser).toHaveBeenCalledTimes(2);
    });

    it('syncs the same session again once the memo is ten minutes old', async () => {
      mockAuthService.syncUser.mockResolvedValue({ id: 'user-1' });
      const session = { id: auth('auth-1'), email: 'a@example.com' };
      const start = Date.now();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(start);

      try {
        await interceptor.intercept(
          mockExecutionContext(session, { id: 'user-1' }),
          mockCallHandler,
        );
        await flush();
        clock.mockReturnValue(start + 10 * 60 * 1000 - 1);
        await interceptor.intercept(
          mockExecutionContext(session, { id: 'user-1' }),
          mockCallHandler,
        );
        expect(mockAuthService.syncUser).toHaveBeenCalledTimes(1);

        clock.mockReturnValue(start + 10 * 60 * 1000);
        await interceptor.intercept(
          mockExecutionContext(session, { id: 'user-1' }),
          mockCallHandler,
        );
        expect(mockAuthService.syncUser).toHaveBeenCalledTimes(2);
      } finally {
        clock.mockRestore();
      }
    });

    it('forgets the session heard from longest ago past 5,000 sessions', async () => {
      mockAuthService.syncUser.mockResolvedValue({ id: 'user-1' });
      const first = { id: auth('auth-first'), email: 'a@example.com' };
      const second = { id: auth('auth-second'), email: 'a@example.com' };

      await interceptor.intercept(mockExecutionContext(first), mockCallHandler);
      await interceptor.intercept(
        mockExecutionContext(second),
        mockCallHandler,
      );
      for (let i = 0; i < 4_999; i += 1) {
        await interceptor.intercept(
          mockExecutionContext({ id: auth(`auth-${i}`), email: 'x@e.com' }),
          mockCallHandler,
        );
      }
      mockAuthService.syncUser.mockClear();

      await interceptor.intercept(
        mockExecutionContext(second, { id: 'user-1' }),
        mockCallHandler,
      );
      expect(mockAuthService.syncUser).not.toHaveBeenCalled();
      await interceptor.intercept(
        mockExecutionContext(first, { id: 'user-1' }),
        mockCallHandler,
      );
      expect(mockAuthService.syncUser).toHaveBeenCalledTimes(1);
    });

    it('shares its memo between the instances each module builds', async () => {
      mockAuthService.syncUser.mockResolvedValue({ id: 'user-1' });
      const other = new AuthSyncInterceptor(
        mockAuthService as unknown as AuthService,
        mockTimeZones as unknown as TimeZoneSyncService,
      );
      const session = { id: auth('auth-1'), email: 'a@example.com' };

      await interceptor.intercept(
        mockExecutionContext(session, { id: 'user-1' }),
        mockCallHandler,
      );
      await flush();
      await other.intercept(
        mockExecutionContext(session, { id: 'user-1' }),
        mockCallHandler,
      );

      expect(mockAuthService.syncUser).toHaveBeenCalledTimes(1);
    });
  });

  it('makes one waited sync for a burst that carries the same session', async () => {
    mockAuthService.syncUser.mockResolvedValue({ id: 'user-1' });
    const session = { id: auth('auth-burst'), email: 'a@example.com' };
    const contexts = [1, 2, 3].map(() => mockExecutionContext(session));

    await Promise.all(
      contexts.map((ctx) => interceptor.intercept(ctx, mockCallHandler)),
    );

    expect(mockAuthService.syncUser).toHaveBeenCalledTimes(1);
    for (const ctx of contexts) {
      expect(ctx.switchToHttp().getRequest().appUser).toEqual({
        id: 'user-1',
      });
    }
  });
});
