import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ChapterGuard } from './chapter.guard';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import {
  SUBSCRIPTION_EXEMPT_KEY,
  SUBSCRIPTION_FREE_TIER_KEY,
} from '../decorators/subscription.decorator';
import type { SubscriptionStatus } from '../../domain/entities/chapter.entity';

describe('ChapterGuard', () => {
  let guard: ChapterGuard;
  let reflector: Reflector;
  let mockFrom: jest.Mock;

  const buildRequest = (overrides: Record<string, unknown> = {}) => ({
    headers: { 'x-chapter-id': 'chapter-1' },
    method: 'GET',
    supabaseUser: { id: 'auth-123' },
    appUser: undefined as unknown,
    member: undefined as unknown,
    chapterId: undefined as unknown,
    subscriptionStatus: undefined as unknown,
    ...overrides,
  });

  const mockExecutionContext = (
    request: ReturnType<typeof buildRequest>,
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    }) as unknown as ExecutionContext;

  const mockSupabaseChain = ({
    appUser,
    member,
    chapter,
  }: {
    appUser?: { id: string } | null;
    member?: { id: string; role_ids: string[] } | null;
    chapter?: { subscription_status: SubscriptionStatus } | null;
  }) => {
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      const data =
        table === 'users' ? appUser : table === 'members' ? member : chapter;
      const eqMock: jest.Mock = jest.fn();
      const single = jest.fn().mockResolvedValue({ data });
      // chapters and users use one .eq; members uses two .eq calls
      eqMock.mockReturnValue({ eq: eqMock, single });
      return {
        select: jest.fn().mockReturnValue({ eq: eqMock }),
      };
    });
    return () => callCount;
  };

  beforeEach(async () => {
    mockFrom = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChapterGuard,
        Reflector,
        {
          provide: SUPABASE_CLIENT,
          useValue: { from: mockFrom },
        },
      ],
    }).compile();

    guard = module.get(ChapterGuard);
    reflector = module.get(Reflector);
  });

  it('should throw ForbiddenException when x-chapter-id header is missing', async () => {
    const request = buildRequest({ headers: {} });
    const ctx = mockExecutionContext(request);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException when supabaseUser is not set', async () => {
    const request = buildRequest({ supabaseUser: undefined });
    const ctx = mockExecutionContext(request);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException when app user not found', async () => {
    mockSupabaseChain({ appUser: null });
    const ctx = mockExecutionContext(buildRequest());
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException when user is not a chapter member', async () => {
    mockSupabaseChain({ appUser: { id: 'user-1' }, member: null });
    const ctx = mockExecutionContext(buildRequest());
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException when chapter row missing', async () => {
    mockSupabaseChain({
      appUser: { id: 'user-1' },
      member: { id: 'member-1', role_ids: ['role-1'] },
      chapter: null,
    });
    const ctx = mockExecutionContext(buildRequest());
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should set appUser, member, chapterId, subscriptionStatus on valid read', async () => {
    const appUser = { id: 'user-1' };
    const member = { id: 'member-1', role_ids: ['role-1'] };
    mockSupabaseChain({
      appUser,
      member,
      chapter: { subscription_status: 'active' },
    });

    const request = buildRequest();
    const ctx = mockExecutionContext(request);
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(request.appUser).toEqual(appUser);
    expect(request.member).toEqual(member);
    expect(request.chapterId).toBe('chapter-1');
    expect(request.subscriptionStatus).toBe('active');
  });

  describe('subscription enforcement', () => {
    const baseValid = () =>
      mockSupabaseChain({
        appUser: { id: 'user-1' },
        member: { id: 'member-1', role_ids: ['role-1'] },
        chapter: { subscription_status: 'active' },
      });

    const withStatus = (status: SubscriptionStatus) =>
      mockSupabaseChain({
        appUser: { id: 'user-1' },
        member: { id: 'member-1', role_ids: ['role-1'] },
        chapter: { subscription_status: status },
      });

    it.each<SubscriptionStatus>([
      'active',
      'past_due',
      'canceled',
      'incomplete',
    ])('allows GET reads for %s', async (status) => {
      withStatus(status);
      const request = buildRequest({ method: 'GET' });
      await expect(
        guard.canActivate(mockExecutionContext(request)),
      ).resolves.toBe(true);
    });

    it.each(['GET', 'HEAD', 'OPTIONS'])(
      'allows %s reads when canceled',
      async (method) => {
        withStatus('canceled');
        const request = buildRequest({ method });
        await expect(
          guard.canActivate(mockExecutionContext(request)),
        ).resolves.toBe(true);
      },
    );

    it('allows writes when active', async () => {
      baseValid();
      const request = buildRequest({ method: 'POST' });
      await expect(
        guard.canActivate(mockExecutionContext(request)),
      ).resolves.toBe(true);
    });

    it('blocks writes with code chapter.subscription.canceled when canceled', async () => {
      withStatus('canceled');
      const request = buildRequest({ method: 'POST' });
      await expect(
        guard.canActivate(mockExecutionContext(request)),
      ).rejects.toMatchObject({
        response: { code: 'chapter.subscription.canceled' },
      });
    });

    it('blocks paid-ops writes with code chapter.subscription.write_locked when past_due', async () => {
      withStatus('past_due');
      const request = buildRequest({ method: 'POST' });
      await expect(
        guard.canActivate(mockExecutionContext(request)),
      ).rejects.toMatchObject({
        response: { code: 'chapter.subscription.write_locked' },
      });
    });

    it('blocks paid-ops writes with code chapter.subscription.required when incomplete', async () => {
      withStatus('incomplete');
      const request = buildRequest({ method: 'POST' });
      await expect(
        guard.canActivate(mockExecutionContext(request)),
      ).rejects.toMatchObject({
        response: { code: 'chapter.subscription.required' },
      });
    });

    it('allows free-tier writes when past_due', async () => {
      withStatus('past_due');
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key) => key === SUBSCRIPTION_FREE_TIER_KEY);
      const request = buildRequest({ method: 'POST' });
      await expect(
        guard.canActivate(mockExecutionContext(request)),
      ).resolves.toBe(true);
    });

    it('allows free-tier writes when incomplete', async () => {
      withStatus('incomplete');
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key) => key === SUBSCRIPTION_FREE_TIER_KEY);
      const request = buildRequest({ method: 'POST' });
      await expect(
        guard.canActivate(mockExecutionContext(request)),
      ).resolves.toBe(true);
    });

    it('still blocks free-tier writes when canceled', async () => {
      withStatus('canceled');
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key) => key === SUBSCRIPTION_FREE_TIER_KEY);
      const request = buildRequest({ method: 'POST' });
      await expect(
        guard.canActivate(mockExecutionContext(request)),
      ).rejects.toMatchObject({
        response: { code: 'chapter.subscription.canceled' },
      });
    });

    it('allows exempt routes regardless of status', async () => {
      withStatus('canceled');
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key) => key === SUBSCRIPTION_EXEMPT_KEY);
      const request = buildRequest({ method: 'POST' });
      await expect(
        guard.canActivate(mockExecutionContext(request)),
      ).resolves.toBe(true);
    });
  });
});
