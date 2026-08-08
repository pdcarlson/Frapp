import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ChapterGuard } from './chapter.guard';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import {
  SUBSCRIPTION_EXEMPT_KEY,
  SUBSCRIPTION_FREE_TIER_KEY,
  SUBSCRIPTION_GRACE_BLOCKED_KEY,
} from '../decorators/subscription.decorator';
import { REQUIRED_MODULE_KEY } from '../decorators/module.decorator';
import type { SubscriptionStatus } from '../../domain/entities/chapter.entity';

describe('ChapterGuard', () => {
  let guard: ChapterGuard;
  let reflector: Reflector;
  let mockFrom: jest.Mock;

  const buildRequest = (overrides: Record<string, unknown> = {}) => ({
    headers: { 'x-chapter-id': 'chapter-1' },
    method: 'GET',
    supabaseUser: { id: 'auth-123' },
    jwtClaims: undefined as unknown,
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
    memberships,
  }: {
    appUser?: { id: string } | null;
    member?: {
      id: string;
      role_ids: string[];
      custom_role_ids?: string[];
    } | null;
    chapter?: {
      subscription_status: SubscriptionStatus;
      past_due_since?: string | null;
      enabled_modules?: Record<string, boolean> | null;
    } | null;
    /** Rows returned by the auto-resolve lookup (`.eq(user_id).limit(2)`). */
    memberships?: Array<{
      id: string;
      role_ids: string[];
      custom_role_ids?: string[];
      chapter_id: string;
    }>;
  }) => {
    let callCount = 0;
    const selectArgs: Record<string, string[]> = {};
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      const data =
        table === 'users' ? appUser : table === 'members' ? member : chapter;
      const eqMock: jest.Mock = jest.fn();
      const single = jest.fn().mockResolvedValue({ data });
      const limit = jest.fn().mockResolvedValue({ data: memberships ?? [] });
      // chapters and users use one .eq; members uses either two .eq calls
      // (explicit chapter) or one .eq + .limit (auto-resolve).
      eqMock.mockReturnValue({ eq: eqMock, single, limit });
      return {
        select: jest.fn().mockImplementation((columns: string) => {
          (selectArgs[table] ??= []).push(columns);
          return { eq: eqMock };
        }),
      };
    });
    return { callCount: () => callCount, selectArgs };
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

  // spec/behavior/multi-tenancy.md: "the JWT claim is authoritative; the
  // `x-chapter-id` request header is accepted only as a fallback ... the header
  // never overrides the JWT."
  describe('chapter context resolution', () => {
    const membership = (chapterId: string) => ({
      id: `member-${chapterId}`,
      role_ids: ['role-1'],
      chapter_id: chapterId,
    });

    it('rejects a header that disagrees with the JWT claim (chapter.context.mismatch)', async () => {
      mockSupabaseChain({ appUser: { id: 'user-1' } });
      const ctx = mockExecutionContext(
        buildRequest({
          headers: { 'x-chapter-id': 'chapter-header' },
          jwtClaims: { active_chapter_id: 'chapter-jwt' },
        }),
      );

      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        response: { code: 'chapter.context.mismatch' },
        status: 403,
      });
    });

    it('lets the JWT claim win when the header is absent', async () => {
      mockSupabaseChain({
        appUser: { id: 'user-1' },
        member: { id: 'member-1', role_ids: [] },
        chapter: { subscription_status: 'active' },
      });
      const request = buildRequest({
        headers: {},
        jwtClaims: { active_chapter_id: 'chapter-jwt' },
      });

      await expect(
        guard.canActivate(mockExecutionContext(request)),
      ).resolves.toBe(true);
      expect(request.chapterId).toBe('chapter-jwt');
    });

    it('auto-resolves a single-chapter user carrying no context at all', async () => {
      mockSupabaseChain({
        appUser: { id: 'user-1' },
        memberships: [membership('chapter-sole')],
        chapter: { subscription_status: 'active' },
      });
      const request = buildRequest({ headers: {} });

      await expect(
        guard.canActivate(mockExecutionContext(request)),
      ).resolves.toBe(true);
      expect(request.chapterId).toBe('chapter-sole');
    });

    it('requires explicit context from a multi-chapter user (chapter.context.required)', async () => {
      mockSupabaseChain({
        appUser: { id: 'user-1' },
        memberships: [membership('chapter-a'), membership('chapter-b')],
      });
      const ctx = mockExecutionContext(buildRequest({ headers: {} }));

      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        response: { code: 'chapter.context.required' },
        status: 400,
      });
    });

    it('requires explicit context when the user has no memberships', async () => {
      mockSupabaseChain({ appUser: { id: 'user-1' }, memberships: [] });
      const ctx = mockExecutionContext(buildRequest({ headers: {} }));

      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        response: { code: 'chapter.context.required' },
        status: 400,
      });
    });

    it('rejects a chapter the caller is not a member of (chapter.context.invalid)', async () => {
      mockSupabaseChain({ appUser: { id: 'user-1' }, member: null });
      const ctx = mockExecutionContext(
        buildRequest({ headers: { 'x-chapter-id': 'chapter-foreign' } }),
      );

      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        response: { code: 'chapter.context.invalid' },
        status: 403,
      });
    });

    it('still accepts the header when the token predates the claim', async () => {
      mockSupabaseChain({
        appUser: { id: 'user-1' },
        member: { id: 'member-1', role_ids: [] },
        chapter: { subscription_status: 'active' },
      });
      const request = buildRequest({
        headers: { 'x-chapter-id': 'chapter-header' },
        jwtClaims: undefined,
      });

      await expect(
        guard.canActivate(mockExecutionContext(request)),
      ).resolves.toBe(true);
      expect(request.chapterId).toBe('chapter-header');
    });
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

  it('selects custom_role_ids on the membership and carries it into request.member', async () => {
    // PermissionsGuard resolves custom-role capabilities from
    // request.member.custom_role_ids — if this select drops the column, the
    // bridge silently stops enforcing for the whole request.
    const member = {
      id: 'member-1',
      role_ids: ['role-1'],
      custom_role_ids: ['custom-1'],
    };
    const chain = mockSupabaseChain({
      appUser: { id: 'user-1' },
      member,
      chapter: { subscription_status: 'active' },
    });

    const request = buildRequest();
    const ctx = mockExecutionContext(request);
    await guard.canActivate(ctx);

    expect(request.member).toEqual(member);
    for (const columns of chain.selectArgs['members'] ?? []) {
      expect(columns).toContain('custom_role_ids');
    }
    expect((chain.selectArgs['members'] ?? []).length).toBeGreaterThan(0);
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

    // Pin "now" and stage a past_due chapter that lapsed `daysAgo` days ago so
    // grace-window boundaries are deterministic (no real clocks).
    const NOW = Date.parse('2026-06-02T12:00:00.000Z');
    const withPastDue = (daysAgo: number) => {
      jest
        .spyOn(guard as unknown as { currentTime: () => number }, 'currentTime')
        .mockReturnValue(NOW);
      mockSupabaseChain({
        appUser: { id: 'user-1' },
        member: { id: 'member-1', role_ids: ['role-1'] },
        chapter: {
          subscription_status: 'past_due',
          past_due_since: new Date(
            NOW - daysAgo * 24 * 60 * 60 * 1000,
          ).toISOString(),
        },
      });
    };
    const asFreeTier = () =>
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key) => key === SUBSCRIPTION_FREE_TIER_KEY);
    const asGraceBlockedFreeTier = () =>
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation(
          (key) =>
            key === SUBSCRIPTION_FREE_TIER_KEY ||
            key === SUBSCRIPTION_GRACE_BLOCKED_KEY,
        );

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

    describe('past_due grace window (FRA-109)', () => {
      it('allows free-tier writes during grace (0 days)', async () => {
        withPastDue(0);
        asFreeTier();
        const request = buildRequest({ method: 'POST' });
        await expect(
          guard.canActivate(mockExecutionContext(request)),
        ).resolves.toBe(true);
      });

      it('blocks grace-blocked invite writes during grace with invite_blocked', async () => {
        withPastDue(2);
        asGraceBlockedFreeTier();
        const request = buildRequest({ method: 'POST' });
        await expect(
          guard.canActivate(mockExecutionContext(request)),
        ).rejects.toMatchObject({
          response: { code: 'chapter.subscription.invite_blocked' },
        });
      });

      it('still within grace at exactly 3 days: invite blocked, free-tier allowed', async () => {
        withPastDue(3);
        asGraceBlockedFreeTier();
        await expect(
          guard.canActivate(
            mockExecutionContext(buildRequest({ method: 'POST' })),
          ),
        ).rejects.toMatchObject({
          response: { code: 'chapter.subscription.invite_blocked' },
        });

        withPastDue(3);
        asFreeTier();
        await expect(
          guard.canActivate(
            mockExecutionContext(buildRequest({ method: 'POST' })),
          ),
        ).resolves.toBe(true);
      });

      it('hard-locks free-tier writes after grace (4 days) with write_locked', async () => {
        withPastDue(4);
        asFreeTier();
        const request = buildRequest({ method: 'POST' });
        await expect(
          guard.canActivate(mockExecutionContext(request)),
        ).rejects.toMatchObject({
          response: { code: 'chapter.subscription.write_locked' },
        });
      });

      it('blocks paid-ops writes during grace with write_locked', async () => {
        withPastDue(1);
        const request = buildRequest({ method: 'POST' });
        await expect(
          guard.canActivate(mockExecutionContext(request)),
        ).rejects.toMatchObject({
          response: { code: 'chapter.subscription.write_locked' },
        });
      });

      it('treats null past_due_since as within grace (free-tier allowed)', async () => {
        mockSupabaseChain({
          appUser: { id: 'user-1' },
          member: { id: 'member-1', role_ids: ['role-1'] },
          chapter: { subscription_status: 'past_due', past_due_since: null },
        });
        asFreeTier();
        const request = buildRequest({ method: 'POST' });
        await expect(
          guard.canActivate(mockExecutionContext(request)),
        ).resolves.toBe(true);
      });

      it('blocks @GraceBlocked invite when past_due_since is null (treated as within grace)', async () => {
        mockSupabaseChain({
          appUser: { id: 'user-1' },
          member: { id: 'member-1', role_ids: ['role-1'] },
          chapter: { subscription_status: 'past_due', past_due_since: null },
        });
        asGraceBlockedFreeTier();
        const request = buildRequest({ method: 'POST' });
        await expect(
          guard.canActivate(mockExecutionContext(request)),
        ).rejects.toMatchObject({
          response: { code: 'chapter.subscription.invite_blocked' },
        });
      });

      it('ignores grace-blocked marker when incomplete (free wedge preserved)', async () => {
        withStatus('incomplete');
        asGraceBlockedFreeTier();
        const request = buildRequest({ method: 'POST' });
        await expect(
          guard.canActivate(mockExecutionContext(request)),
        ).resolves.toBe(true);
      });
    });
  });

  // #264: the web client hides disabled modules from the sidebar, the Cmd+K
  // menu, and the slash palette, but a direct API call bypasses all three.
  // spec/product/modules.md: "Data is preserved — re-enabling restores
  // access", so this gates writes only.
  describe('module enforcement', () => {
    const withModules = (
      enabled_modules: Record<string, boolean> | null,
      status: SubscriptionStatus = 'active',
    ) =>
      mockSupabaseChain({
        appUser: { id: 'user-1' },
        member: { id: 'member-1', role_ids: ['role-1'] },
        chapter: { subscription_status: status, enabled_modules },
      });

    /** Stands in for `@RequireModule(key)` on the handler/controller. */
    const requiresModule = (key: string) =>
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((metadataKey) =>
          metadataKey === REQUIRED_MODULE_KEY ? key : undefined,
        );

    it('rejects a write to an explicitly disabled module', async () => {
      withModules({ events: false });
      requiresModule('events');
      const request = buildRequest({ method: 'POST' });

      await expect(
        guard.canActivate(mockExecutionContext(request)),
      ).rejects.toMatchObject({
        response: { code: 'chapter.module.disabled' },
        status: 403,
      });
    });

    it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
      'rejects %s to a disabled module',
      async (method) => {
        withModules({ points: false });
        requiresModule('points');

        await expect(
          guard.canActivate(mockExecutionContext(buildRequest({ method }))),
        ).rejects.toBeInstanceOf(ForbiddenException);
      },
    );

    // The toggle hides and freezes a surface; it must not strand the
    // chapter's existing data behind it, or re-enabling could not restore it.
    it.each(['GET', 'HEAD', 'OPTIONS'])(
      'allows %s on a disabled module so data stays readable',
      async (method) => {
        withModules({ events: false });
        requiresModule('events');

        await expect(
          guard.canActivate(mockExecutionContext(buildRequest({ method }))),
        ).resolves.toBe(true);
      },
    );

    it('allows a write when the module is explicitly enabled', async () => {
      withModules({ events: true });
      requiresModule('events');

      await expect(
        guard.canActivate(mockExecutionContext(buildRequest({ method: 'POST' }))),
      ).resolves.toBe(true);
    });

    // Mirrors the client contract in use-org-config.ts: enabled unless the
    // chapter explicitly said false. A chapter predating a module has no key
    // for it and must not be locked out of something it never turned off.
    it('treats a module absent from enabled_modules as enabled', async () => {
      withModules({ tasks: false });
      requiresModule('events');

      await expect(
        guard.canActivate(mockExecutionContext(buildRequest({ method: 'POST' }))),
      ).resolves.toBe(true);
    });

    it('treats a null enabled_modules column as all-enabled', async () => {
      withModules(null);
      requiresModule('events');

      await expect(
        guard.canActivate(mockExecutionContext(buildRequest({ method: 'POST' }))),
      ).resolves.toBe(true);
    });

    it('leaves undecorated routes alone even when modules are disabled', async () => {
      withModules({ events: false, points: false });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      await expect(
        guard.canActivate(mockExecutionContext(buildRequest({ method: 'POST' }))),
      ).resolves.toBe(true);
    });

    // Billing state is the more actionable error, and a module toggle is
    // meaningless while every write is already locked.
    it('reports the subscription failure first when both would reject', async () => {
      withModules({ events: false }, 'canceled');
      requiresModule('events');

      await expect(
        guard.canActivate(mockExecutionContext(buildRequest({ method: 'POST' }))),
      ).rejects.toMatchObject({
        response: { code: 'chapter.subscription.canceled' },
      });
    });

    it('selects enabled_modules in the chapter projection', async () => {
      const { selectArgs } = withModules({ events: true });
      requiresModule('events');

      await guard.canActivate(
        mockExecutionContext(buildRequest({ method: 'POST' })),
      );
      expect(selectArgs['chapters']?.[0]).toContain('enabled_modules');
    });
  });
});
