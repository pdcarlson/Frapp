jest.mock('node:crypto', () => {
  let counter = 0;
  return {
    ...jest.requireActual<typeof import('node:crypto')>('node:crypto'),
    // Unique per call, unlike a fixed string — several tests below (batch and
    // bulk-email creation) rely on each generated invite having its own
    // token, the way real UUIDs would.
    randomUUID: () => `test-uuid-${++counter}`,
  };
});

/** Flushes both the microtask queue and one macrotask turn — enough for a
 * chain of `await`s (including one through `.catch()`) to fully settle. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { InviteService, inviteStatus, verifiedEmailOf } from './invite.service';
import { MEMBER_JOINED_AUDIENCE } from '@repo/validation';
import { SystemPermissions } from '#domain/constants/permissions';
import { INVITE_REPOSITORY } from '#domain/repositories/invite.repository.interface';
import type { IInviteRepository } from '#domain/repositories/invite.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import type { IRoleRepository } from '#domain/repositories/role.repository.interface';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '#domain/repositories/chapter.repository.interface';
import type { Chapter } from '#domain/entities/chapter.entity';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import type { Invite } from '#domain/entities/invite.entity';
import type { Role } from '#domain/entities/role.entity';
import type { Member } from '#domain/entities/member.entity';
import { SystemRoleKeys } from '#domain/constants/permissions';
import { NotificationService } from './notification.service';
import { RbacService } from './rbac.service';
import {
  CHAPTER_ID,
  USER,
  tieredChapterRoles,
  tieredRankContext,
} from '#test/helpers/tiered-chapter.fixture';
import { ActivationService } from './activation.service';
import { ChatService } from './chat.service';
import { LegalAcceptanceService } from './legal-acceptance.service';
import { ConfigService } from '@nestjs/config';
import { EMAIL_PROVIDER } from '#domain/adapters/email.interface';
import type { IEmailProvider } from '#domain/adapters/email.interface';
import { CHAT_MESSAGE_REPOSITORY } from '#domain/repositories/chat.repository.interface';
import {
  memberFixture,
  roleFixture,
  userFixture,
} from '#test/helpers/entity-fixtures';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(() => 'event-exception'),
  captureMessage: jest.fn(() => 'event-message'),
}));

const captureException = jest.mocked(Sentry.captureException);

describe('InviteService', () => {
  let service: InviteService;
  let mockInviteRepo: jest.Mocked<IInviteRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;
  let mockRoleRepo: jest.Mocked<IRoleRepository>;
  let mockNotificationService: jest.Mocked<
    Pick<NotificationService, 'notifyUser' | 'notifyChapter' | 'notifyMembers'>
  >;
  let mockActivation: jest.Mocked<Pick<ActivationService, 'record'>>;
  let mockRbac: jest.Mocked<
    Pick<RbacService, 'findUserIdsWithAnyPermissions' | 'getRankContext'>
  >;
  let mockEmailProvider: jest.Mocked<IEmailProvider>;
  let mockConfig: jest.Mocked<Pick<ConfigService, 'get'>>;
  let mockUserRepo: jest.Mocked<IUserRepository>;
  let mockChatService: jest.Mocked<Pick<ChatService, 'getOrCreateDm'>>;
  let mockChapterRepo: jest.Mocked<IChapterRepository>;
  let mockLegalAcceptance: jest.Mocked<
    Pick<LegalAcceptanceService, 'requireOrAccept'>
  >;
  let messageInsert: jest.Mock;
  /** Backs `chapters.default_invite_role_id` for the mock above (#422). */
  let chapterDefaultRoleId: string | null;

  beforeEach(async () => {
    captureException.mockClear();
    mockInviteRepo = {
      findById: jest.fn(),
      findByToken: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      markRevoked: jest.fn().mockResolvedValue(undefined),
      revokePending: jest.fn().mockResolvedValue(undefined),
      findPendingByEmail: jest.fn().mockResolvedValue([]),
      markUsedAtomically: jest.fn(),
      releaseClaim: jest.fn().mockResolvedValue(true),
    };

    mockMemberRepo = {
      findById: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findByUser: jest.fn(),
      findChapterMemberIdentities: jest.fn(),
      transferPresidencyAtomic: jest.fn(),
      claimPresidencyAtomic: jest.fn(),
      setRoleIds: jest.fn(),
    };

    mockRoleRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn().mockResolvedValue([]),
      findByIds: jest.fn(),
      findByChapterAndName: jest.fn(),
      findByChapterAndSystemKey: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      createMany: jest.fn(),
    };

    mockNotificationService = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      notifyChapter: jest.fn().mockResolvedValue(undefined),
      notifyMembers: jest.fn().mockResolvedValue(undefined),
    };

    mockActivation = { record: jest.fn().mockResolvedValue(true) };
    // Nobody can act on a join unless a test says so (#3656).
    mockRbac = {
      findUserIdsWithAnyPermissions: jest.fn().mockResolvedValue([]),
      // The inviter holds `*` unless a test says otherwise, so the rank rule
      // (#4071) lets every role through.
      getRankContext: jest.fn().mockResolvedValue({
        reach: {
          memberId: 'member-president',
          rank: 0,
          permissions: new Set(['*']),
          wildcard: true,
        },
        roles: [],
        tiers: [],
        positions: new Map(),
      }),
    };

    mockEmailProvider = { sendInviteEmail: jest.fn().mockResolvedValue(true) };
    mockConfig = { get: jest.fn().mockReturnValue(undefined) };

    mockUserRepo = {
      findById: jest.fn().mockResolvedValue(null),
      findByIds: jest.fn().mockResolvedValue([]),
      findDisplayIdentitiesByIds: jest.fn(),
      findContactsByIds: jest.fn(),
      findBySupabaseAuthId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      anonymize: jest.fn(),
      compareAndSetWhatsNewSeen: jest.fn(),
    };
    mockChatService = {
      getOrCreateDm: jest
        .fn()
        .mockResolvedValue({ id: 'dm-1', type: 'DM', member_ids: [] }),
    };
    messageInsert = jest.fn().mockResolvedValue({ id: 'msg-1' });
    // #422: `resolveInviteRole` reads `chapters.default_invite_role_id`
    // through the chapter repository whenever the caller does not name a
    // role. Defaults to "no default configured", which is the pre-#422 world
    // every other test in this file assumes.
    chapterDefaultRoleId = null;
    mockChapterRepo = {
      findById: jest.fn(),
      findByIds: jest.fn(),
      isAnalyticsOptedOut: jest.fn(),
      findBySubscriptionId: jest.fn(),
      findByCustomerId: jest.fn(),
      claimSubscriptionId: jest.fn(),
      updatePaletteIfSeedUnchanged: jest.fn(),
      applySubscriptionWebhook: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    // Read lazily so a test can set `chapterDefaultRoleId` after setup.
    mockChapterRepo.findById.mockImplementation(() =>
      Promise.resolve({
        id: 'ch-1',
        default_invite_role_id: chapterDefaultRoleId,
      } as Chapter),
    );

    // Passes by default: the Terms gate has its own describe block below, and
    // its logic is LegalAcceptanceService's (legal-acceptance.service.spec.ts).
    mockLegalAcceptance = {
      requireOrAccept: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InviteService,
        { provide: INVITE_REPOSITORY, useValue: mockInviteRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: ROLE_REPOSITORY, useValue: mockRoleRepo },
        { provide: CHAPTER_REPOSITORY, useValue: mockChapterRepo },
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: ActivationService, useValue: mockActivation },
        { provide: ChatService, useValue: mockChatService },
        { provide: EMAIL_PROVIDER, useValue: mockEmailProvider },
        { provide: ConfigService, useValue: mockConfig },
        {
          provide: CHAT_MESSAGE_REPOSITORY,
          useValue: { create: messageInsert },
        },
        { provide: LegalAcceptanceService, useValue: mockLegalAcceptance },
        { provide: RbacService, useValue: mockRbac },
      ],
    }).compile();

    service = module.get(InviteService);
  });

  it('should create invite with 24h expiry (no billing check in the service; gating is ChapterGuard)', async () => {
    mockInviteRepo.create.mockImplementation((data) =>
      Promise.resolve({
        id: 'inv-1',
        token: data.token!,
        chapter_id: data.chapter_id!,
        role: data.role!,
        expires_at: data.expires_at!,
        created_by: data.created_by!,
        used_at: null,
        created_at: '2024-01-01',
        email: null,
        revoked_at: null,
      }),
    );

    const result = await service.create('ch-1', 'user-1', 'Member');

    expect(mockInviteRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        chapter_id: 'ch-1',
        role: 'Member',
        created_by: 'user-1',
      }),
    );
    const createCall = mockInviteRepo.create.mock.calls[0][0];
    expect(typeof createCall.token).toBe('string');
    expect(createCall.token!.length).toBeGreaterThan(0);
    const expiresAt = new Date(createCall.expires_at!);
    const now = new Date();
    expect(expiresAt.getTime()).toBeGreaterThan(now.getTime());
    expect(expiresAt.getTime() - now.getTime()).toBeLessThanOrEqual(
      24 * 60 * 60 * 1000 + 5000,
    );
    expect(result.token).toBe(createCall.token);
  });

  it('should create batch invites using createMany', async () => {
    mockInviteRepo.createMany.mockImplementation((data) =>
      Promise.resolve(
        data.map((d, i) => ({
          id: `inv-${i + 1}`,
          token: d.token!,
          chapter_id: d.chapter_id!,
          role: d.role!,
          expires_at: d.expires_at!,
          created_by: d.created_by!,
          used_at: null,
          created_at: '2024-01-01',
          email: null,
          revoked_at: null,
        })),
      ),
    );

    const result = await service.createBatch('ch-1', 'user-1', 'Member', 3);

    expect(mockInviteRepo.createMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          chapter_id: 'ch-1',
          role: 'Member',
          created_by: 'user-1',
        }),
      ]),
    );
    const batchTokens = mockInviteRepo.createMany.mock.calls[0][0].map(
      (d) => d.token,
    );
    expect(new Set(batchTokens).size).toBe(3);
    expect(mockInviteRepo.createMany).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(3);
    // Activation funnel step 2 (#267) — a batch is still one milestone.
    expect(mockActivation.record).toHaveBeenCalledWith(
      'ch-1',
      'activation-first-invite-created',
      { batch_size: 3 },
    );
  });

  describe('createWithEmails', () => {
    beforeEach(() => {
      // Echoes back the token exactly as `createMany` receives it — the same
      // shape a real `.insert(data).select()` round-trip has, and the
      // property the token-correlation fix (below) depends on.
      mockInviteRepo.createMany.mockImplementation((data) =>
        Promise.resolve(
          data.map((d, i) => ({
            id: `inv-${i + 1}`,
            token: d.token!,
            chapter_id: d.chapter_id!,
            role: d.role!,
            expires_at: d.expires_at!,
            created_by: d.created_by!,
            used_at: null,
            created_at: '2024-01-01',
            email: null,
            revoked_at: null,
          })),
        ),
      );
    });

    it('creates one invite per unique email and sends each a join link', async () => {
      mockChapterRepo.findById.mockResolvedValue({
        id: 'ch-1',
        name: 'Phi Gamma Delta Tau Nu',
      } as never);
      mockUserRepo.findById.mockResolvedValue({
        id: 'user-1',
        display_name: 'Paul Carlson',
      } as never);
      const result = await service.createWithEmails(
        'ch-1',
        'user-1',
        'Member',
        ['a@example.com', 'b@example.com'],
      );

      expect(mockInviteRepo.createMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ chapter_id: 'ch-1', role: 'Member' }),
        ]),
      );
      const inviteData = mockInviteRepo.createMany.mock.calls[0][0];
      expect(inviteData).toHaveLength(2);
      expect(mockEmailProvider.sendInviteEmail).toHaveBeenCalledTimes(2);
      // Each row remembers its address, for the inviter's list.
      expect(inviteData.map((d) => d.email)).toEqual([
        'a@example.com',
        'b@example.com',
      ]);
      expect(mockEmailProvider.sendInviteEmail).toHaveBeenCalledTimes(2);
      expect(mockEmailProvider.sendInviteEmail).toHaveBeenCalledWith({
        to: 'a@example.com',
        joinUrl: `https://app.frapp.live/join?token=${inviteData[0].token}`,
        role: 'Member',
        chapterName: 'Phi Gamma Delta Tau Nu',
        inviterName: 'Paul Carlson',
      });
      expect(mockEmailProvider.sendInviteEmail).toHaveBeenCalledWith({
        to: 'b@example.com',
        joinUrl: `https://app.frapp.live/join?token=${inviteData[1].token}`,
        role: 'Member',
        chapterName: 'Phi Gamma Delta Tau Nu',
        inviterName: 'Paul Carlson',
      });
      expect(result.invites).toHaveLength(2);
      expect(result.invites[0]).toEqual(
        expect.objectContaining({ status: 'pending' }),
      );
      expect(result.invites[0]).not.toHaveProperty('created_by');
      expect(result.failed).toEqual([]);
    });

    it('still sends when the chapter or inviter read fails, without their names', async () => {
      mockChapterRepo.findById.mockRejectedValue(new Error('timeout'));
      mockUserRepo.findById.mockRejectedValue(new Error('timeout'));

      const result = await service.createWithEmails(
        'ch-1',
        'user-1',
        'Member',
        ['a@example.com'],
      );

      expect(mockEmailProvider.sendInviteEmail).toHaveBeenCalledWith(
        expect.objectContaining({ chapterName: null, inviterName: null }),
      );
      expect(result.failed).toEqual([]);
    });

    it("replaces an address's older pending invite once the new one reaches it", async () => {
      const older = (
        id: string,
        email: string,
        used_at: string | null = null,
      ) => ({
        id,
        token: `tok-${id}`,
        chapter_id: 'ch-1',
        role: 'Member',
        expires_at: '2099-01-01',
        created_by: 'user-1',
        used_at,
        created_at: '2023-12-31',
        email,
        revoked_at: null,
      });
      mockInviteRepo.findByChapter.mockResolvedValue([
        older('old-a', 'A@example.com'),
        older('old-b', 'b@example.com'),
        older('joined-a', 'a@example.com', '2024-01-01'),
      ]);
      // a@ is delivered; b@ fails, so b@'s older invite stays live.
      mockEmailProvider.sendInviteEmail.mockImplementation(({ to }) =>
        Promise.resolve(to === 'a@example.com'),
      );

      await service.createWithEmails('ch-1', 'user-1', 'Member', [
        'a@example.com',
        'b@example.com',
      ]);

      expect(mockInviteRepo.revokePending).toHaveBeenCalledWith(['old-a']);
    });

    it('correlates by token rather than array position, even if the repository returns rows out of order', async () => {
      mockInviteRepo.createMany.mockImplementation((data) =>
        Promise.resolve(
          // Deliberately reversed to prove the correlation isn't positional.
          [...data].reverse().map((d, i) => ({
            id: `inv-${i + 1}`,
            token: d.token!,
            chapter_id: d.chapter_id!,
            role: d.role!,
            expires_at: d.expires_at!,
            created_by: d.created_by!,
            used_at: null,
            created_at: '2024-01-01',
            email: null,
            revoked_at: null,
          })),
        ),
      );

      await service.createWithEmails('ch-1', 'user-1', 'Member', [
        'a@example.com',
        'b@example.com',
      ]);

      const inviteData = mockInviteRepo.createMany.mock.calls[0][0];
      expect(mockEmailProvider.sendInviteEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'a@example.com',
          joinUrl: `https://app.frapp.live/join?token=${inviteData[0].token}`,
        }),
      );
      expect(mockEmailProvider.sendInviteEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'b@example.com',
          joinUrl: `https://app.frapp.live/join?token=${inviteData[1].token}`,
        }),
      );
    });

    it('caps concurrent email sends rather than firing every address at once', async () => {
      const pending: Array<() => void> = [];
      mockEmailProvider.sendInviteEmail.mockImplementation(
        () =>
          new Promise((resolve) => {
            pending.push(() => resolve(true));
          }),
      );

      const promise = service.createWithEmails('ch-1', 'user-1', 'Member', [
        'a@example.com',
        'b@example.com',
        'c@example.com',
        'd@example.com',
        'e@example.com',
      ]);

      await flushMicrotasks();
      expect(mockEmailProvider.sendInviteEmail).toHaveBeenCalledTimes(2);

      pending.shift()!();
      await flushMicrotasks();
      expect(mockEmailProvider.sendInviteEmail).toHaveBeenCalledTimes(3);

      // Drain the rest: each resolution schedules a microtask that starts the
      // next send (pushing a new resolver), so this has to alternate
      // drain-then-flush rather than resolve everything in one synchronous
      // pass — otherwise the later sends it triggers are never reached.
      for (let i = 0; i < 10; i++) {
        while (pending.length) pending.shift()!();
        await flushMicrotasks();
      }
      await promise;
    });

    it('treats a rejected sendInviteEmail call as a delivery failure rather than crashing the batch', async () => {
      mockEmailProvider.sendInviteEmail
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(true);

      const result = await service.createWithEmails(
        'ch-1',
        'user-1',
        'Member',
        ['bad@example.com', 'ok@example.com'],
      );

      expect(result.invites).toHaveLength(2);
      expect(result.failed).toEqual(['bad@example.com']);
    });

    it('de-dupes case-insensitively, keeping the first-seen casing', async () => {
      await service.createWithEmails('ch-1', 'user-1', 'Member', [
        'Same@Example.com',
        'same@example.com',
      ]);

      expect(mockInviteRepo.createMany.mock.calls[0][0]).toHaveLength(1);
      expect(mockEmailProvider.sendInviteEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'Same@Example.com' }),
      );
    });

    it('builds the join link against a configured APP_URL', async () => {
      mockConfig.get.mockImplementation((key: string) =>
        key === 'APP_URL' ? 'https://app.staging.frapp.live/' : undefined,
      );

      await service.createWithEmails('ch-1', 'user-1', 'Member', [
        'a@example.com',
      ]);

      const inviteData = mockInviteRepo.createMany.mock.calls[0][0];
      expect(mockEmailProvider.sendInviteEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          joinUrl: `https://app.staging.frapp.live/join?token=${inviteData[0].token}`,
        }),
      );
    });

    it('refuses a public http: APP_URL before inserting invite tokens', async () => {
      mockConfig.get.mockImplementation((key: string) =>
        key === 'APP_URL' ? 'http://app.example.com' : undefined,
      );

      await expect(
        service.createWithEmails('ch-1', 'user-1', 'Member', ['a@example.com']),
      ).rejects.toThrow(/must use https:/);
      expect(mockInviteRepo.createMany).not.toHaveBeenCalled();
      expect(mockEmailProvider.sendInviteEmail).not.toHaveBeenCalled();
    });

    it('reports a per-address failure without failing the whole batch', async () => {
      mockEmailProvider.sendInviteEmail
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const result = await service.createWithEmails(
        'ch-1',
        'user-1',
        'Member',
        ['ok@example.com', 'bad@example.com'],
      );

      expect(result.invites).toHaveLength(2);
      expect(result.failed).toEqual(['bad@example.com']);
    });

    it('records the invite-created activation milestone with the real batch size', async () => {
      await service.createWithEmails('ch-1', 'user-1', 'Member', [
        'a@example.com',
        'b@example.com',
      ]);

      expect(mockActivation.record).toHaveBeenCalledWith(
        'ch-1',
        'activation-first-invite-created',
        { batch_size: 2 },
      );
    });
  });

  it('records the invite-created activation milestone on a single invite (#267)', async () => {
    mockInviteRepo.create.mockResolvedValue({
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: '2099-01-01',
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
    });

    await service.create('ch-1', 'user-1', 'Member');

    expect(mockActivation.record).toHaveBeenCalledWith(
      'ch-1',
      'activation-first-invite-created',
      { batch_size: 1 },
    );
  });

  it('should redeem valid invite', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
    };
    const memberRole: Role = roleFixture({
      id: 'role-member',
      name: 'Member',
      system_key: SystemRoleKeys.MEMBER,
      is_system: true,
      display_order: 3,
    });
    const member: Member = memberFixture({
      user_id: 'user-2',
      role_ids: [memberRole.id],
    });
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
    mockInviteRepo.markUsedAtomically.mockResolvedValue(
      '2026-01-01T00:00:00.000Z',
    );
    mockRoleRepo.findByChapter.mockResolvedValue([memberRole]);
    mockMemberRepo.create.mockResolvedValue(member);

    const result = await service.redeem('test-uuid', 'user-2');

    expect(mockInviteRepo.findByToken).toHaveBeenCalledWith('test-uuid');
    expect(mockMemberRepo.findByUserAndChapter).toHaveBeenCalledWith(
      'user-2',
      'ch-1',
    );
    expect(mockInviteRepo.markUsedAtomically).toHaveBeenCalledWith('inv-1');
    expect(mockMemberRepo.create).toHaveBeenCalledWith({
      user_id: 'user-2',
      chapter_id: 'ch-1',
      role_ids: [memberRole.id],
    });
    expect(result).toEqual({ chapterId: 'ch-1', memberId: 'member-1' });
    // Activation funnel step 3 (#267) — recorded only on a successful join.
    expect(mockActivation.record).toHaveBeenCalledWith(
      'ch-1',
      'activation-first-invite-redeemed',
    );
  });

  // #1546. `POST /v1/invites/redeem` carries no ChapterGuard (the chapter that
  // matters is the invite's, not the caller's), so the subscription hard lock
  // is evaluated here: a canceled chapter, or a past_due one past its grace
  // window, cannot gain a member through a token minted before it lapsed.
  describe('preview (#3352)', () => {
    const LIVE_UNTIL = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const invite = (overrides: Partial<Invite> = {}): Invite => ({
      id: 'inv-p',
      token: 'preview-token',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: LIVE_UNTIL,
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
      ...overrides,
    });
    const chapter = (
      branding: Record<string, unknown>,
      name = 'FIJI Tau Nu',
    ): Chapter =>
      ({
        id: 'ch-1',
        name,
        university: 'Rensselaer Polytechnic Institute',
        accent_color: '#5b2c83',
        branding,
      }) as Chapter;

    beforeEach(() => {
      mockInviteRepo.findByToken.mockResolvedValue(invite());
      mockChapterRepo.findById.mockResolvedValue(
        chapter({ short_name: 'FIJI', greek_letters: 'ΦΓΔ' }),
      );
      mockUserRepo.findById.mockResolvedValue(
        userFixture({ id: 'user-1', display_name: 'Paul Carlson' }),
      );
      mockRoleRepo.findByChapter.mockResolvedValue([
        roleFixture({
          id: 'r-member',
          name: 'Brother',
          system_key: SystemRoleKeys.MEMBER,
        }),
      ]);
    });

    it('names the chapter, the inviter and the role, and uses nothing up', async () => {
      await expect(service.preview('preview-token')).resolves.toEqual({
        chapter_name: 'FIJI Tau Nu',
        university: 'Rensselaer Polytechnic Institute',
        mark_text: 'FIJI',
        accent_color: '#5b2c83',
        invited_by: 'Paul Carlson',
        // "Member" isn't a role here, so the redeem would grant only the
        // Everyone role, which no card names (#4191).
        role: null,
        expires_at: LIVE_UNTIL,
      });
      expect(mockInviteRepo.markUsedAtomically).not.toHaveBeenCalled();
      expect(mockMemberRepo.create).not.toHaveBeenCalled();
      expect(mockLegalAcceptance.requireOrAccept).not.toHaveBeenCalled();
    });

    it('names a role the chapter gave the invite (#4191)', async () => {
      mockInviteRepo.findByToken.mockResolvedValue(
        invite({ role: 'Brothers' }),
      );
      mockRoleRepo.findByChapter.mockResolvedValue([
        roleFixture({
          id: 'r-member',
          name: 'Everyone',
          system_key: SystemRoleKeys.MEMBER,
        }),
        roleFixture({
          id: 'r-brothers',
          name: 'Brothers',
          system_key: null,
          is_system: false,
          permissions: ['members:view'],
        }),
      ]);
      expect((await service.preview('preview-token')).role).toBe('Brothers');
    });

    it('never sends letters a chapter hides', async () => {
      // A name no letter-hiding organization matches, so only the chapter's
      // own stored switch can keep the letters off (the default name is a
      // FIJI chapter, which the org override would hide anyway).
      mockChapterRepo.findById.mockResolvedValue(
        chapter({ greek_letters: 'ΦΓΔ', show_greek_letters: false }, 'Tau Nu'),
      );
      const preview = await service.preview('preview-token');
      expect(preview.mark_text).toBeNull();
      expect(JSON.stringify(preview)).not.toContain('ΦΓΔ');
    });

    // Any character in the Greek and Coptic block or Greek Extended.
    const GREEK = /[\u0370-\u03FF\u1F00-\u1FFF]/u;

    it.each(['Phi Gamma Delta Tau Nu', 'Phi Gamma Delta', 'FIJI'])(
      'never sends the letters of an organization that hides them, with no switch stored (%s, #3421)',
      async (name) => {
        // A chapter created before FIJI's profile turned letters off stores
        // them with no switch, which on its own means shown.
        mockChapterRepo.findById.mockResolvedValue(
          chapter({ greek_letters: 'ΦΓΔ' }, name),
        );
        const preview = await service.preview('preview-token');
        expect(preview.mark_text).toBeNull();
        expect(JSON.stringify(preview)).not.toMatch(GREEK);
      },
    );

    it('still sends the letters of an organization that shows them', async () => {
      mockChapterRepo.findById.mockResolvedValue(
        chapter({ greek_letters: 'ΣΦΕ' }, 'Sigma Phi Epsilon California Eta'),
      );
      const preview = await service.preview('preview-token');
      expect(preview.mark_text).toBe('ΣΦΕ');
      expect(preview.mark_text).toMatch(GREEK);
    });

    it('names no role when the redeem would grant none', async () => {
      // The invite's role is gone and there is no seeded Member role: redeem
      // inserts the membership with no roles, so the card mustn't promise one.
      mockRoleRepo.findByChapter.mockResolvedValue([]);
      await expect(service.preview('preview-token')).resolves.toMatchObject({
        role: null,
      });
    });

    it('still previews when the inviter profile is gone', async () => {
      mockUserRepo.findById.mockResolvedValue(null);
      await expect(service.preview('preview-token')).resolves.toMatchObject({
        invited_by: null,
      });
    });

    it.each([
      ['unknown', null],
      ['used', invite({ used_at: '2024-01-02' })],
      ['expired', invite({ expires_at: '2020-01-01T00:00:00.000Z' })],
    ])('answers 410 for a %s invite, as redeem does', async (_label, found) => {
      mockInviteRepo.findByToken.mockResolvedValue(found);
      await expect(service.preview('preview-token')).rejects.toBeInstanceOf(
        GoneException,
      );
    });

    it('answers 410 when the chapter is gone', async () => {
      mockChapterRepo.findById.mockResolvedValue(null);
      await expect(service.preview('preview-token')).rejects.toBeInstanceOf(
        GoneException,
      );
    });
  });

  describe('verifiedEmailOf (#3776)', () => {
    it('is the address only once Auth has confirmed it', () => {
      expect(
        verifiedEmailOf({
          email: 'a@school.edu',
          email_confirmed_at: '2026-11-01T00:00:00Z',
        }),
      ).toBe('a@school.edu');
      expect(
        verifiedEmailOf({ email: 'a@school.edu', email_confirmed_at: null }),
      ).toBeNull();
      expect(verifiedEmailOf({ email: 'a@school.edu' })).toBeNull();
      expect(
        verifiedEmailOf({ email: '', email_confirmed_at: '2026-11-01' }),
      ).toBeNull();
      expect(verifiedEmailOf(undefined)).toBeNull();
    });
  });

  describe('findPendingForVerifiedEmail (#3776)', () => {
    const LIVE_UNTIL = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const invite = (overrides: Partial<Invite> = {}): Invite => ({
      id: 'inv-m',
      token: 'mine-token',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: LIVE_UNTIL,
      created_by: 'user-1',
      used_at: null,
      created_at: '2026-11-08T00:00:00Z',
      email: 'Alice@School.edu',
      revoked_at: null,
      ...overrides,
    });

    beforeEach(() => {
      mockChapterRepo.findById.mockImplementation((id: string) =>
        Promise.resolve({
          id,
          name: id === 'ch-1' ? 'Sigma Chi Alpha' : 'Theta Chi Beta',
          university: 'State',
          accent_color: null,
          branding: {},
        } as unknown as Chapter),
      );
      mockUserRepo.findById.mockResolvedValue(
        userFixture({ id: 'user-1', display_name: 'Paul Carlson' }),
      );
      mockRoleRepo.findByChapter.mockResolvedValue([
        roleFixture({
          id: 'r-member',
          name: 'Member',
          system_key: SystemRoleKeys.MEMBER,
        }),
      ]);
      mockMemberRepo.findByUser.mockResolvedValue([]);
    });

    it('reads nothing without a verified address', async () => {
      await expect(
        service.findPendingForVerifiedEmail(null, 'joiner'),
      ).resolves.toEqual([]);
      await expect(
        service.findPendingForVerifiedEmail('  ', 'joiner'),
      ).resolves.toEqual([]);
      expect(mockInviteRepo.findPendingByEmail).not.toHaveBeenCalled();
    });

    it("asks only for the caller's verified address, and returns the card with its token", async () => {
      mockInviteRepo.findPendingByEmail.mockResolvedValue([invite()]);
      const rows = await service.findPendingForVerifiedEmail(
        'alice@school.edu',
        'joiner',
      );
      expect(mockInviteRepo.findPendingByEmail).toHaveBeenCalledWith(
        'alice@school.edu',
        expect.any(Date),
      );
      expect(rows).toEqual([
        {
          chapter_name: 'Sigma Chi Alpha',
          university: 'State',
          mark_text: null,
          accent_color: null,
          invited_by: 'Paul Carlson',
          // An invite into the Everyone role names no role (#4191).
          role: null,
          expires_at: LIVE_UNTIL,
          token: 'mine-token',
        },
      ]);
      // A read: nothing is claimed, joined or accepted.
      expect(mockInviteRepo.markUsedAtomically).not.toHaveBeenCalled();
      expect(mockMemberRepo.create).not.toHaveBeenCalled();
    });

    it('leaves out chapters the caller already belongs to', async () => {
      mockInviteRepo.findPendingByEmail.mockResolvedValue([
        invite({ chapter_id: 'ch-1', token: 't1' }),
        invite({ chapter_id: 'ch-2', token: 't2' }),
      ]);
      mockMemberRepo.findByUser.mockResolvedValue([
        memberFixture({ user_id: 'joiner', chapter_id: 'ch-1' }),
      ]);
      const rows = await service.findPendingForVerifiedEmail(
        'alice@school.edu',
        'joiner',
      );
      expect(rows.map((r) => r.token)).toEqual(['t2']);
    });

    it('offers one invite per chapter, the newest', async () => {
      // The repository answers newest first.
      mockInviteRepo.findPendingByEmail.mockResolvedValue([
        invite({ id: 'newer', token: 'newer-token' }),
        invite({ id: 'older', token: 'older-token' }),
      ]);
      const rows = await service.findPendingForVerifiedEmail(
        'alice@school.edu',
        'joiner',
      );
      expect(rows.map((r) => r.token)).toEqual(['newer-token']);
    });

    it('drops an invite whose chapter is gone', async () => {
      mockInviteRepo.findPendingByEmail.mockResolvedValue([invite()]);
      mockChapterRepo.findById.mockResolvedValue(null);
      await expect(
        service.findPendingForVerifiedEmail('alice@school.edu', 'joiner'),
      ).resolves.toEqual([]);
    });
  });

  describe('redeem into a chapter under the subscription hard lock (#1546)', () => {
    const liveInvite = (): Invite => ({
      id: 'inv-locked',
      token: 'locked-token',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
    });
    const lockedChapter = (overrides: Partial<Chapter>): Chapter =>
      ({
        id: 'ch-1',
        default_invite_role_id: null,
        subscription_status: 'active',
        past_due_since: null,
        ...overrides,
      }) as Chapter;

    beforeEach(() => {
      mockInviteRepo.findByToken.mockResolvedValue(liveInvite());
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
      mockInviteRepo.markUsedAtomically.mockResolvedValue(
        '2026-01-01T00:00:00.000Z',
      );
      mockRoleRepo.findByChapter.mockResolvedValue([]);
      mockMemberRepo.create.mockResolvedValue(
        memberFixture({
          id: 'member-x',
          user_id: 'user-2',
        }),
      );
    });

    it('refuses a canceled chapter with 403 and leaves the token unconsumed', async () => {
      mockChapterRepo.findById.mockResolvedValue(
        lockedChapter({ subscription_status: 'canceled' }),
      );

      await expect(
        service.redeem('locked-token', 'user-2'),
      ).rejects.toMatchObject({
        status: 403,
        response: expect.objectContaining({
          code: 'chapter.subscription.canceled',
        }),
      });
      // The token survives: the chapter may recover inside its lifetime.
      expect(mockInviteRepo.markUsedAtomically).not.toHaveBeenCalled();
      expect(mockMemberRepo.create).not.toHaveBeenCalled();
      expect(mockActivation.record).not.toHaveBeenCalled();
      expect(mockNotificationService.notifyChapter).not.toHaveBeenCalled();
    });

    it('refuses a past_due chapter whose 3-day grace window has run out', async () => {
      const fourDaysAgo = new Date(
        Date.now() - 4 * 24 * 60 * 60 * 1000,
      ).toISOString();
      mockChapterRepo.findById.mockResolvedValue(
        lockedChapter({
          subscription_status: 'past_due',
          past_due_since: fourDaysAgo,
        }),
      );

      await expect(
        service.redeem('locked-token', 'user-2'),
      ).rejects.toMatchObject({
        status: 403,
        response: expect.objectContaining({
          code: 'chapter.subscription.write_locked',
        }),
      });
      expect(mockInviteRepo.markUsedAtomically).not.toHaveBeenCalled();
    });

    it('still admits a past_due chapter inside its grace window — the same rule as the guard', async () => {
      const oneDayAgo = new Date(
        Date.now() - 24 * 60 * 60 * 1000,
      ).toISOString();
      mockChapterRepo.findById.mockResolvedValue(
        lockedChapter({
          subscription_status: 'past_due',
          past_due_since: oneDayAgo,
        }),
      );

      await expect(
        service.redeem('locked-token', 'user-2'),
      ).resolves.toMatchObject({ chapterId: 'ch-1' });
      expect(mockMemberRepo.create).toHaveBeenCalled();
    });

    it('admits an incomplete (never-paid) chapter — minting is free-tier there too', async () => {
      mockChapterRepo.findById.mockResolvedValue(
        lockedChapter({ subscription_status: 'incomplete' }),
      );

      await expect(
        service.redeem('locked-token', 'user-2'),
      ).resolves.toMatchObject({ chapterId: 'ch-1' });
    });

    it('still answers 409 to an existing member of a locked chapter — their next action is different', async () => {
      mockChapterRepo.findById.mockResolvedValue(
        lockedChapter({ subscription_status: 'canceled' }),
      );
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(
        memberFixture({
          id: 'member-existing',
          user_id: 'user-2',
          has_completed_onboarding: true,
        }),
      );

      await expect(
        service.redeem('locked-token', 'user-2'),
      ).rejects.toMatchObject({
        status: 409,
      });
      expect(mockChapterRepo.findById).not.toHaveBeenCalled();
    });

    it('checks the lock only after the token itself is valid', async () => {
      // A dead token is a 410 regardless of the chapter's state: the caller's
      // next action ("ask for a new invite") is the same either way, and the
      // chapter is never even loaded.
      mockInviteRepo.findByToken.mockResolvedValue({
        ...liveInvite(),
        used_at: '2024-01-02',
      });
      mockChapterRepo.findById.mockResolvedValue(
        lockedChapter({ subscription_status: 'canceled' }),
      );

      await expect(
        service.redeem('locked-token', 'user-2'),
      ).rejects.toMatchObject({
        status: 410,
      });
      expect(mockChapterRepo.findById).not.toHaveBeenCalled();
    });
  });

  // #2302: every member accepts the Terms before they can post. The rule lives
  // in LegalAcceptanceService; what redeem owns is when it runs, and that a
  // refusal leaves the token usable.
  describe('redeem requires the current Terms (#2302)', () => {
    const liveInvite = (): Invite => ({
      id: 'inv-terms',
      token: 'terms-token',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
    });
    const refusal = () =>
      new ForbiddenException({
        code: 'legal.acceptance_required',
        message:
          'Agree to the Terms of Service and Privacy Policy to continue.',
      });

    beforeEach(() => {
      mockInviteRepo.findByToken.mockResolvedValue(liveInvite());
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
      mockInviteRepo.markUsedAtomically.mockResolvedValue(
        '2026-01-01T00:00:00.000Z',
      );
      mockRoleRepo.findByChapter.mockResolvedValue([]);
      mockMemberRepo.create.mockResolvedValue(
        memberFixture({
          id: 'member-t',
          user_id: 'user-2',
        }),
      );
    });

    it('asks the gate without acceptance when the checkbox is not sent', async () => {
      await service.redeem('terms-token', 'user-2');

      expect(mockLegalAcceptance.requireOrAccept).toHaveBeenCalledWith(
        'user-2',
        false,
      );
    });

    it('passes a ticked checkbox to the gate, before the membership exists', async () => {
      await service.redeem('terms-token', 'user-2', true);

      expect(mockLegalAcceptance.requireOrAccept).toHaveBeenCalledWith(
        'user-2',
        true,
      );
      expect(
        mockLegalAcceptance.requireOrAccept.mock.invocationCallOrder[0],
      ).toBeLessThan(mockMemberRepo.create.mock.invocationCallOrder[0]);
    });

    it('refuses the join with legal.acceptance_required and leaves the token unconsumed', async () => {
      mockLegalAcceptance.requireOrAccept.mockRejectedValueOnce(refusal());

      await expect(
        service.redeem('terms-token', 'user-2'),
      ).rejects.toMatchObject({
        status: 403,
        response: expect.objectContaining({
          code: 'legal.acceptance_required',
        }),
      });
      // The same link works once they tick the box.
      expect(mockInviteRepo.markUsedAtomically).not.toHaveBeenCalled();
      expect(mockMemberRepo.create).not.toHaveBeenCalled();
    });

    it('answers a dead token with 410, not a request for the checkbox', async () => {
      mockInviteRepo.findByToken.mockResolvedValue({
        ...liveInvite(),
        used_at: '2026-01-01T00:00:00.000Z',
      });

      await expect(
        service.redeem('terms-token', 'user-2'),
      ).rejects.toBeInstanceOf(GoneException);
      expect(mockLegalAcceptance.requireOrAccept).not.toHaveBeenCalled();
    });

    it('answers an existing member with 409, not a request for the checkbox', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue({
        id: 'member-existing',
      } as Member);

      await expect(
        service.redeem('terms-token', 'user-2'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockLegalAcceptance.requireOrAccept).not.toHaveBeenCalled();
    });

    it('answers a locked chapter with its lock, not a request for the checkbox', async () => {
      mockChapterRepo.findById.mockResolvedValue({
        id: 'ch-1',
        default_invite_role_id: null,
        subscription_status: 'canceled',
        past_due_since: null,
      } as Chapter);

      await expect(
        service.redeem('terms-token', 'user-2'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'chapter.subscription.canceled',
        }),
      });
      expect(mockLegalAcceptance.requireOrAccept).not.toHaveBeenCalled();
    });
  });

  describe('notifyInviterOfAcceptance (#596)', () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
    };
    const memberRole: Role = roleFixture({
      id: 'role-member',
      name: 'Member',
      system_key: SystemRoleKeys.MEMBER,
      is_system: true,
      display_order: 3,
    });
    const member: Member = memberFixture({
      user_id: 'user-2',
      role_ids: [memberRole.id],
    });

    beforeEach(() => {
      mockInviteRepo.findByToken.mockResolvedValue(invite);
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
      mockInviteRepo.markUsedAtomically.mockResolvedValue(
        '2026-01-01T00:00:00.000Z',
      );
      mockRoleRepo.findByChapter.mockResolvedValue([memberRole]);
      mockMemberRepo.create.mockResolvedValue(member);
    });

    it('DMs the inviter with a system_audit message naming the accepter', async () => {
      mockUserRepo.findById.mockResolvedValue(
        userFixture({
          id: 'user-2',
          supabase_auth_id: 'auth-2',
          email: 'alex@example.com',
          display_name: 'Alex Chen',
        }),
      );

      await service.redeem('test-uuid', 'user-2');

      expect(mockChatService.getOrCreateDm).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        member_ids: ['user-1', 'user-2'],
      });
      expect(messageInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          channel_id: 'dm-1',
          sender_id: '00000000-0000-0000-0000-000000000000',
          content: 'Alex Chen accepted your invite.',
          kind: 'system_audit',
        }),
      );
    });

    it('does not roll back redemption when the accepter profile cannot be found', async () => {
      mockUserRepo.findById.mockResolvedValue(null);

      const result = await service.redeem('test-uuid', 'user-2');

      expect(result).toEqual({ chapterId: 'ch-1', memberId: 'member-1' });
      expect(mockChatService.getOrCreateDm).not.toHaveBeenCalled();
    });

    it('does not roll back redemption when the DM/message write throws', async () => {
      mockUserRepo.findById.mockResolvedValue(
        userFixture({
          id: 'user-2',
          supabase_auth_id: 'auth-2',
          email: 'alex@example.com',
          display_name: 'Alex Chen',
        }),
      );
      // A departed inviter, a chat outage, or any other DM-path failure —
      // this covers the "missing inviter" edge case the fix must survive.
      mockChatService.getOrCreateDm.mockRejectedValue(new Error('boom'));

      const result = await service.redeem('test-uuid', 'user-2');

      expect(result).toEqual({ chapterId: 'ch-1', memberId: 'member-1' });
    });

    it('does not roll back redemption when the notice insert fails', async () => {
      mockUserRepo.findById.mockResolvedValue(
        userFixture({
          id: 'user-2',
          supabase_auth_id: 'auth-2',
          email: 'alex@example.com',
          display_name: 'Alex Chen',
        }),
      );
      messageInsert.mockRejectedValue(new Error('insert failed'));

      const result = await service.redeem('test-uuid', 'user-2');

      expect(result).toEqual({ chapterId: 'ch-1', memberId: 'member-1' });
      expect(messageInsert).toHaveBeenCalledTimes(1);
    });

    it('skips the DM entirely when the accepter is the invite creator (rejoin)', async () => {
      mockInviteRepo.findByToken.mockResolvedValue({
        ...invite,
        created_by: 'user-2',
      });
      mockUserRepo.findById.mockResolvedValue(
        userFixture({
          id: 'user-2',
          supabase_auth_id: 'auth-2',
          email: 'alex@example.com',
          display_name: 'Alex Chen',
        }),
      );

      const result = await service.redeem('test-uuid', 'user-2');

      expect(result).toEqual({ chapterId: 'ch-1', memberId: 'member-1' });
      // Would otherwise have produced a degenerate self-DM (member_ids [x, x]).
      expect(mockChatService.getOrCreateDm).not.toHaveBeenCalled();
      expect(messageInsert).not.toHaveBeenCalled();
    });
  });

  it('does not record a redemption milestone when the invite is expired (#267)', async () => {
    mockInviteRepo.findByToken.mockResolvedValue({
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: '2020-01-01',
      created_by: 'user-1',
      used_at: null,
      created_at: '2019-01-01',
      email: null,
      revoked_at: null,
    });

    await expect(service.redeem('test-uuid', 'user-2')).rejects.toThrow(
      GoneException,
    );
    expect(mockActivation.record).not.toHaveBeenCalled();
  });

  it('should fall back to Member role when invite role not found', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'NonExistentRole',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
    };
    const memberRole: Role = roleFixture({
      id: 'role-member',
      name: 'Member',
      system_key: SystemRoleKeys.MEMBER,
      is_system: true,
      display_order: 3,
    });
    const member: Member = memberFixture({
      user_id: 'user-2',
      role_ids: [memberRole.id],
    });
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
    mockInviteRepo.markUsedAtomically.mockResolvedValue(
      '2026-01-01T00:00:00.000Z',
    );
    mockRoleRepo.findByChapter.mockResolvedValue([memberRole]);
    mockMemberRepo.create.mockResolvedValue(member);

    const result = await service.redeem('test-uuid', 'user-2');

    expect(mockMemberRepo.create).toHaveBeenCalledWith({
      user_id: 'user-2',
      chapter_id: 'ch-1',
      role_ids: [memberRole.id],
    });
    expect(result).toEqual({ chapterId: 'ch-1', memberId: 'member-1' });
  });

  // FRA-320: the fallback used to match the literal name 'Member', so a chapter
  // that relabelled its seeded Member role left redeemers with no role at all.
  it('falls back to the seeded Member role even after it is renamed', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'NonExistentRole',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
    };
    const renamedMemberRole: Role = roleFixture({
      id: 'role-member',
      name: 'Active Brother',
      system_key: SystemRoleKeys.MEMBER,
      is_system: true,
      display_order: 3,
    });
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
    mockInviteRepo.markUsedAtomically.mockResolvedValue(
      '2026-01-01T00:00:00.000Z',
    );
    mockRoleRepo.findByChapter.mockResolvedValue([renamedMemberRole]);
    mockMemberRepo.create.mockResolvedValue(
      memberFixture({
        user_id: 'user-2',
        role_ids: [renamedMemberRole.id],
      }),
    );

    await service.redeem('test-uuid', 'user-2');

    expect(mockMemberRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ role_ids: ['role-member'] }),
    );
  });

  // 2026-11-07: two testers invited as "Cabinet", a role a Discord import
  // brought over with only `channels:read:cabinet`, were refused on every
  // screen because nothing gave them `members:view`.
  describe('a custom role with no base access comes with Member', () => {
    const memberRole: Role = roleFixture({
      id: 'role-member',
      name: 'Member',
      system_key: SystemRoleKeys.MEMBER,
      is_system: true,
      display_order: 5,
    });
    const cabinetRole: Role = roleFixture({
      id: 'role-cabinet',
      name: 'Cabinet',
      system_key: null,
      is_system: false,
      display_order: 21,
      permissions: ['channels:read:cabinet'],
    });
    const newMemberRole: Role = roleFixture({
      id: 'role-new-member',
      name: 'New Member',
      system_key: SystemRoleKeys.NEW_MEMBER,
      is_system: true,
      display_order: 6,
      permissions: ['members:view', 'backwork:upload'],
    });

    function inviteFor(role: string): Invite {
      return {
        id: 'inv-1',
        token: 'test-uuid',
        chapter_id: 'ch-1',
        role,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        created_by: 'user-1',
        used_at: null,
        created_at: '2024-01-01',
        email: null,
        revoked_at: null,
      };
    }

    beforeEach(() => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
      mockInviteRepo.markUsedAtomically.mockResolvedValue(
        '2026-01-01T00:00:00.000Z',
      );
      mockRoleRepo.findByChapter.mockResolvedValue([
        memberRole,
        cabinetRole,
        newMemberRole,
      ]);
      mockMemberRepo.create.mockResolvedValue(memberFixture());
    });

    it('grants Member after a custom role that lacks members:view', async () => {
      mockInviteRepo.findByToken.mockResolvedValue(inviteFor('Cabinet'));

      await service.redeem('test-uuid', 'user-2');

      // The invited role stays first: web's Members list labels by role_ids[0].
      expect(mockMemberRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role_ids: ['role-cabinet', 'role-member'],
        }),
      );
    });

    it('grants a custom role that already carries members:view alone', async () => {
      mockRoleRepo.findByChapter.mockResolvedValue([
        memberRole,
        roleFixture({
          id: 'role-guest',
          name: 'Rush Guest',
          system_key: null,
          is_system: false,
          display_order: 22,
          permissions: ['members:view', 'channels:read:rush'],
        }),
      ]);
      mockInviteRepo.findByToken.mockResolvedValue(inviteFor('Rush Guest'));

      await service.redeem('test-uuid', 'user-2');

      expect(mockMemberRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ role_ids: ['role-guest'] }),
      );
    });

    it('grants a seeded role renamed before system_key existed alone', async () => {
      mockRoleRepo.findByChapter.mockResolvedValue([
        memberRole,
        roleFixture({
          id: 'role-pledge',
          name: 'Pledge',
          system_key: null,
          is_system: true,
          display_order: 6,
          permissions: ['backwork:upload'],
        }),
      ]);
      mockInviteRepo.findByToken.mockResolvedValue(inviteFor('Pledge'));

      await service.redeem('test-uuid', 'user-2');

      expect(mockMemberRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ role_ids: ['role-pledge'] }),
      );
    });

    it('grants a seeded role alone', async () => {
      mockInviteRepo.findByToken.mockResolvedValue(inviteFor('New Member'));

      await service.redeem('test-uuid', 'user-2');

      expect(mockMemberRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ role_ids: ['role-new-member'] }),
      );
    });

    it('grants only the custom role when the chapter has no Member role', async () => {
      mockRoleRepo.findByChapter.mockResolvedValue([cabinetRole]);
      mockInviteRepo.findByToken.mockResolvedValue(inviteFor('Cabinet'));

      await service.redeem('test-uuid', 'user-2');

      expect(mockMemberRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ role_ids: ['role-cabinet'] }),
      );
    });
  });

  it('should reject expired invite', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() - 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
    };
    mockInviteRepo.findByToken.mockResolvedValue(invite);

    const promise = service.redeem('test-uuid', 'user-2');
    await expect(promise).rejects.toThrow(GoneException);
    await expect(promise).rejects.toThrow('Invite expired');
    expect(mockMemberRepo.create).not.toHaveBeenCalled();
  });

  it('should reject used invite', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: '2024-01-02',
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
    };
    mockInviteRepo.findByToken.mockResolvedValue(invite);

    const promise = service.redeem('test-uuid', 'user-2');
    await expect(promise).rejects.toThrow(GoneException);
    await expect(promise).rejects.toThrow('Invite already used');
    expect(mockMemberRepo.create).not.toHaveBeenCalled();
  });

  it('should reject if user already member', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
    };
    const existingMember: Member = memberFixture({
      user_id: 'user-2',
      role_ids: ['role-1'],
      has_completed_onboarding: true,
    });
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(existingMember);

    const promise = service.redeem('test-uuid', 'user-2');
    await expect(promise).rejects.toThrow(ConflictException);
    await expect(promise).rejects.toThrow('Already a member of this chapter');
    expect(mockInviteRepo.markUsedAtomically).not.toHaveBeenCalled();
    expect(mockMemberRepo.create).not.toHaveBeenCalled();
  });

  it('should list invites by chapter', async () => {
    const invites: Invite[] = [
      {
        id: 'inv-1',
        token: 'token-1',
        chapter_id: 'ch-1',
        role: 'Member',
        expires_at: '2024-01-02',
        created_by: 'user-1',
        used_at: null,
        created_at: '2024-01-01',
        email: null,
        revoked_at: null,
      },
    ];
    mockInviteRepo.findByChapter.mockResolvedValue(invites);

    const result = await service.findByChapter('ch-1');

    expect(mockInviteRepo.findByChapter).toHaveBeenCalledWith('ch-1');
    // Who sent it and the chapter stay server-side; the status is derived.
    expect(result).toEqual([
      {
        id: 'inv-1',
        token: 'token-1',
        role: 'Member',
        email: null,
        status: 'expired',
        expires_at: '2024-01-02',
        used_at: null,
        revoked_at: null,
        created_at: '2024-01-01',
      },
    ]);
  });

  describe('inviteStatus (#3607)', () => {
    const NOW = new Date('2026-11-06T12:00:00.000Z');
    const base: Invite = {
      id: 'inv-1',
      token: 't',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: '2026-11-07T12:00:00.000Z',
      created_by: 'user-1',
      used_at: null,
      created_at: '2026-11-06T11:00:00.000Z',
      email: null,
      revoked_at: null,
    };

    it.each([
      ['pending', base],
      ['joined', { ...base, used_at: '2026-11-06T11:30:00.000Z' }],
      ['expired', { ...base, expires_at: '2026-11-06T11:59:59.000Z' }],
      // A revoke sets used_at too; revoked_at is what tells them apart.
      [
        'revoked',
        {
          ...base,
          used_at: '2026-11-06T11:30:00.000Z',
          revoked_at: '2026-11-06T11:30:00.000Z',
        },
      ],
      // A used invite past its expiry is still Joined, not Expired.
      [
        'joined',
        {
          ...base,
          used_at: '2026-11-06T11:30:00.000Z',
          expires_at: '2026-11-06T11:59:59.000Z',
        },
      ],
    ] as const)('reads %s', (status, invite) => {
      expect(inviteStatus(invite, NOW)).toBe(status);
    });
  });

  describe('member-joined push (#3656)', () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
    };
    const memberRole: Role = roleFixture({
      id: 'role-member',
      name: 'Member',
      system_key: SystemRoleKeys.MEMBER,
      is_system: true,
      display_order: 3,
    });
    let member: Member;

    beforeEach(() => {
      member = memberFixture({
        user_id: 'user-2',
        role_ids: [memberRole.id],
      });
      mockInviteRepo.findByToken.mockResolvedValue(invite);
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
      mockInviteRepo.markUsedAtomically.mockResolvedValue(
        '2026-01-01T00:00:00.000Z',
      );
      mockRoleRepo.findByChapter.mockResolvedValue([memberRole]);
      mockMemberRepo.create.mockResolvedValue(member);
      mockUserRepo.findByIds.mockResolvedValue([
        userFixture({ id: 'user-2', display_name: 'Alex Smith' }),
      ]);
    });

    it('names the new member to whoever can act on a join', async () => {
      mockRbac.findUserIdsWithAnyPermissions.mockResolvedValue([
        'user-1',
        'user-officer',
      ]);

      await service.redeem('test-uuid', 'user-2');

      expect(mockRbac.findUserIdsWithAnyPermissions).toHaveBeenCalledWith(
        'ch-1',
        MEMBER_JOINED_AUDIENCE,
      );
      expect(mockNotificationService.notifyMembers).toHaveBeenCalledWith(
        'ch-1',
        ['user-1', 'user-officer'],
        expect.objectContaining({
          title: 'Alex Smith joined',
          priority: 'NORMAL',
          category: 'members',
          data: { target: { screen: 'members' }, memberUserId: 'user-2' },
        }),
      );
    });

    it('asks for roster access plus the invite or role-management permission', () => {
      // Spelled as strings in `@repo/validation`, so pin them to the
      // server's own constants: a renamed permission must fail here, not
      // quietly hide the join switch from everyone.
      expect(MEMBER_JOINED_AUDIENCE).toEqual([
        [SystemPermissions.MEMBERS_VIEW, SystemPermissions.MEMBERS_INVITE],
        [SystemPermissions.MEMBERS_VIEW, SystemPermissions.ROLES_MANAGE],
      ]);
    });

    it('never pushes the member who joined, even when they could act on it', async () => {
      mockRbac.findUserIdsWithAnyPermissions.mockResolvedValue([
        'user-2',
        'user-1',
      ]);

      await service.redeem('test-uuid', 'user-2');

      expect(mockNotificationService.notifyMembers).toHaveBeenCalledWith(
        'ch-1',
        ['user-1'],
        expect.anything(),
      );
    });

    it('sends nothing when nobody else can act on a join', async () => {
      mockRbac.findUserIdsWithAnyPermissions.mockResolvedValue(['user-2']);

      await expect(service.redeem('test-uuid', 'user-2')).resolves.toEqual({
        chapterId: 'ch-1',
        memberId: member.id,
      });

      expect(mockNotificationService.notifyMembers).not.toHaveBeenCalled();
    });

    it('still redeems, and reports once, when sending the push fails', async () => {
      mockRbac.findUserIdsWithAnyPermissions.mockResolvedValue(['user-1']);
      mockNotificationService.notifyMembers.mockRejectedValue(
        new Error('push delivery failed'),
      );
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(service.redeem('test-uuid', 'user-2')).resolves.toEqual({
        chapterId: 'ch-1',
        memberId: member.id,
      });

      expect(captureException).toHaveBeenCalledTimes(1);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'push delivery failed' }),
        expect.objectContaining({
          tags: { caught_at: 'invite-redeem-new-member-notify-failed' },
        }),
      );
      error.mockRestore();
    });

    it('still redeems, and reports once, when the member-joined notification fails', async () => {
      mockRbac.findUserIdsWithAnyPermissions.mockRejectedValue(
        new Error('roster read failed'),
      );
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(service.redeem('test-uuid', 'user-2')).resolves.toEqual({
        chapterId: 'ch-1',
        memberId: member.id,
      });

      expect(mockNotificationService.notifyMembers).not.toHaveBeenCalled();
      expect(captureException).toHaveBeenCalledTimes(1);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'roster read failed' }),
        expect.objectContaining({
          level: 'error',
          tags: { caught_at: 'invite-redeem-new-member-notify-failed' },
          fingerprint: [
            'caught-failure',
            'invite-redeem-new-member-notify-failed',
            'Error',
          ],
        }),
      );
      error.mockRestore();
    });
  });

  it('should reject if invite not found', async () => {
    mockInviteRepo.findByToken.mockResolvedValue(null);
    const promise = service.redeem('test-uuid', 'user-2');
    await expect(promise).rejects.toThrow(GoneException);
    await expect(promise).rejects.toThrow('Invite not found');
  });

  it('should reject if invite is not atomically claimed', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
    };
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
    mockRoleRepo.findByChapter.mockResolvedValue([]);
    mockInviteRepo.markUsedAtomically.mockResolvedValue(null);

    const promise = service.redeem('test-uuid', 'user-2');
    await expect(promise).rejects.toThrow(GoneException);
    await expect(promise).rejects.toThrow('Invite already used');
  });

  it('releases the claim when membership insert fails after markUsedAtomically (#1863)', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
    };
    const insertError = new Error('members_user_id_chapter_id_key');
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
    mockInviteRepo.markUsedAtomically.mockResolvedValue(
      '2026-01-01T00:00:00.000Z',
    );
    mockRoleRepo.findByChapter.mockResolvedValue([]);
    mockMemberRepo.create.mockRejectedValue(insertError);

    await expect(service.redeem('test-uuid', 'user-2')).rejects.toBe(
      insertError,
    );
    expect(mockInviteRepo.releaseClaim).toHaveBeenCalledWith(
      'inv-1',
      '2026-01-01T00:00:00.000Z',
    );
    expect(mockActivation.record).not.toHaveBeenCalled();
  });

  it('does not release the claim when insert throws but a membership row exists (#1863)', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
    };
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        memberFixture({
          user_id: 'user-2',
        }),
      );
    mockInviteRepo.markUsedAtomically.mockResolvedValue(
      '2026-01-01T00:00:00.000Z',
    );
    mockRoleRepo.findByChapter.mockResolvedValue([]);
    mockMemberRepo.create.mockRejectedValue(new Error('response dropped'));

    await expect(service.redeem('test-uuid', 'user-2')).rejects.toThrow(
      'response dropped',
    );
    expect(mockInviteRepo.releaseClaim).not.toHaveBeenCalled();
    expect(mockActivation.record).not.toHaveBeenCalled();
  });

  it('does not release the claim when the post-failure membership lookup throws (#1863)', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
    };
    const insertError = new Error('insert failed');
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('lookup failed'));
    mockInviteRepo.markUsedAtomically.mockResolvedValue(
      '2026-01-01T00:00:00.000Z',
    );
    mockRoleRepo.findByChapter.mockResolvedValue([]);
    mockMemberRepo.create.mockRejectedValue(insertError);

    await expect(service.redeem('test-uuid', 'user-2')).rejects.toBe(
      insertError,
    );
    expect(mockInviteRepo.releaseClaim).not.toHaveBeenCalled();
  });

  it('still throws the insert error when releaseClaim itself fails (#1863)', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
    };
    const insertError = new Error('insert failed');
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
    mockInviteRepo.markUsedAtomically.mockResolvedValue(
      '2026-01-01T00:00:00.000Z',
    );
    mockRoleRepo.findByChapter.mockResolvedValue([]);
    mockMemberRepo.create.mockRejectedValue(insertError);
    mockInviteRepo.releaseClaim.mockRejectedValue(new Error('release failed'));
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(service.redeem('test-uuid', 'user-2')).rejects.toBe(
      insertError,
    );
    expect(error).toHaveBeenCalledWith(
      'Failed to release invite after membership insert failed: release failed',
      expect.any(String),
    );
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'release failed' }),
      expect.objectContaining({
        fingerprint: [
          'caught-failure',
          'invite-redeem-claim-release-failed',
          'Error',
        ],
      }),
    );
    error.mockRestore();
  });

  it('does not claim the invite when role lookup fails (#1863)', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
    };
    const lookupError = new Error('roles unavailable');
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
    mockRoleRepo.findByChapter.mockRejectedValue(lookupError);

    await expect(service.redeem('test-uuid', 'user-2')).rejects.toBe(
      lookupError,
    );
    expect(mockInviteRepo.markUsedAtomically).not.toHaveBeenCalled();
    expect(mockMemberRepo.create).not.toHaveBeenCalled();
    expect(mockInviteRepo.releaseClaim).not.toHaveBeenCalled();
  });

  it('does not release a claim when membership insert succeeds', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
    };
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
    mockInviteRepo.markUsedAtomically.mockResolvedValue(
      '2026-01-01T00:00:00.000Z',
    );
    mockRoleRepo.findByChapter.mockResolvedValue([]);
    mockMemberRepo.create.mockResolvedValue(
      memberFixture({
        user_id: 'user-2',
      }),
    );

    await service.redeem('test-uuid', 'user-2');

    expect(mockInviteRepo.releaseClaim).not.toHaveBeenCalled();
  });

  it('should create member without roles if no matching role and no Member role found', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Admin',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
    };
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
    mockInviteRepo.markUsedAtomically.mockResolvedValue(
      '2026-01-01T00:00:00.000Z',
    );
    mockRoleRepo.findByChapter.mockResolvedValue([]);
    mockMemberRepo.create.mockResolvedValue({} as any);

    await service.redeem('test-uuid', 'user-2');

    expect(mockMemberRepo.create).toHaveBeenCalledWith({
      user_id: 'user-2',
      chapter_id: 'ch-1',
      role_ids: [],
    });
  });

  it('should reject if existing member redeeming invite in InviteService', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
      email: null,
      revoked_at: null,
    };
    const existingMember: Member = memberFixture({
      user_id: 'user-2',
      role_ids: ['role-1'],
      has_completed_onboarding: true,
    });
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(existingMember);

    const promise = service.redeem('test-uuid', 'user-2');
    await expect(promise).rejects.toThrow(ConflictException);
    await expect(promise).rejects.toThrow('Already a member of this chapter');
    expect(mockMemberRepo.findByUserAndChapter).toHaveBeenCalledWith(
      'user-2',
      'ch-1',
    );
  });

  describe('revoke', () => {
    it('should mark invite as used', async () => {
      const invite: Invite = {
        id: 'inv-1',
        token: 'test-uuid',
        chapter_id: 'ch-1',
        role: 'Member',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        created_by: 'user-1',
        used_at: null,
        created_at: '2024-01-01',
        email: null,
        revoked_at: null,
      };
      mockInviteRepo.findById.mockResolvedValue(invite);

      await service.revoke('inv-1', 'ch-1');

      expect(mockInviteRepo.findById).toHaveBeenCalledWith('inv-1');
      expect(mockInviteRepo.markRevoked).toHaveBeenCalledWith('inv-1');
    });

    it('should reject already-used invite', async () => {
      const invite: Invite = {
        id: 'inv-1',
        token: 'test-uuid',
        chapter_id: 'ch-1',
        role: 'Member',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        created_by: 'user-1',
        used_at: '2024-01-02',
        created_at: '2024-01-01',
        email: null,
        revoked_at: null,
      };
      mockInviteRepo.findById.mockResolvedValue(invite);

      await expect(service.revoke('inv-1', 'ch-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.revoke('inv-1', 'ch-1')).rejects.toThrow(
        'Invite has already been used',
      );
      expect(mockInviteRepo.markRevoked).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when invite does not exist', async () => {
      mockInviteRepo.findById.mockResolvedValue(null);

      await expect(service.revoke('inv-x', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when invite belongs to different chapter', async () => {
      const invite: Invite = {
        id: 'inv-1',
        token: 'test-uuid',
        chapter_id: 'ch-2',
        role: 'Member',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        created_by: 'user-1',
        used_at: null,
        created_at: '2024-01-01',
        email: null,
        revoked_at: null,
      };
      mockInviteRepo.findById.mockResolvedValue(invite);

      await expect(service.revoke('inv-1', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  /**
   * #422. `role` is optional on the three create routes; when it is absent the
   * service resolves the chapter's configured default, then the seeded Member
   * role.
   */
  // #4071: an invite grants a role ranked at or below the inviter, and never
  // the President's.
  describe('invite role rank rule', () => {
    beforeEach(() => {
      mockRoleRepo.findByChapter.mockResolvedValue(tieredChapterRoles());
      mockInviteRepo.create.mockImplementation((data) =>
        Promise.resolve(data as Invite),
      );
    });

    it("stops a chair minting an officer's invite to redeem on a second account", async () => {
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.riskChair),
      );
      await expect(
        service.create(CHAPTER_ID, USER.riskChair, 'Vice President'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockInviteRepo.create).not.toHaveBeenCalled();
    });

    it('lets a chair invite a peer or a brother', async () => {
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.riskChair),
      );
      await service.create(CHAPTER_ID, USER.riskChair, 'Social chair');
      await service.create(CHAPTER_ID, USER.riskChair, 'Brother');
      expect(mockInviteRepo.create).toHaveBeenCalledTimes(2);
    });

    it("stops an inviter bringing in a role whose permissions they don't hold, a peer's included", async () => {
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.riskChair),
      );
      await expect(
        service.create(CHAPTER_ID, USER.riskChair, 'Treasury assistant'),
      ).rejects.toThrow(/billing:view/);
      // The Vice President ranks with the Treasurer but lacks billing:manage.
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.vicePresident),
      );
      await expect(
        service.create(CHAPTER_ID, USER.vicePresident, 'Treasurer'),
      ).rejects.toThrow(/billing:manage/);
      expect(mockInviteRepo.create).not.toHaveBeenCalled();
    });

    it('stops even the President inviting someone as President', async () => {
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.president),
      );
      await expect(
        service.create(CHAPTER_ID, USER.president, 'President'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('grants the Member role, not the President, for an invite minted before the rule', async () => {
      const memberRole = roleFixture({
        id: 'role-member',
        name: 'Member',
        system_key: SystemRoleKeys.MEMBER,
        is_system: true,
      });
      const presidentRole = roleFixture({
        id: 'role-president',
        name: 'President',
        system_key: SystemRoleKeys.PRESIDENT,
        is_system: true,
        permissions: ['*'],
      });
      mockInviteRepo.findByToken.mockResolvedValue({
        id: 'inv-old',
        token: 'old-token',
        chapter_id: 'ch-1',
        role: 'President',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        created_by: 'user-1',
        used_at: null,
        created_at: '2024-01-01',
        email: null,
        revoked_at: null,
      });
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
      mockInviteRepo.markUsedAtomically.mockResolvedValue(
        '2026-01-01T00:00:00.000Z',
      );
      mockRoleRepo.findByChapter.mockResolvedValue([presidentRole, memberRole]);
      mockMemberRepo.create.mockResolvedValue(
        memberFixture({ user_id: 'user-2', role_ids: [memberRole.id] }),
      );

      await service.redeem('old-token', 'user-2');

      expect(mockMemberRepo.create).toHaveBeenCalledWith({
        user_id: 'user-2',
        chapter_id: 'ch-1',
        role_ids: [memberRole.id],
      });
    });
  });

  describe('default invite role (#422)', () => {
    function role(over: Partial<Role> = {}): Role {
      return roleFixture({
        id: 'role-member',
        name: 'Member',
        system_key: SystemRoleKeys.MEMBER,
        is_system: true,
        display_order: 3,
        ...over,
      });
    }

    const pledgeRole = role({
      id: 'role-pledge',
      name: 'New Member',
      system_key: undefined,
    });

    beforeEach(() => {
      mockRoleRepo.findByChapter.mockResolvedValue([role(), pledgeRole]);
      mockInviteRepo.create.mockImplementation((data) =>
        Promise.resolve(data as Invite),
      );
      mockInviteRepo.createMany.mockImplementation((rows) =>
        Promise.resolve(rows as Invite[]),
      );
    });

    it('uses the chapter default when the caller names no role', async () => {
      chapterDefaultRoleId = 'role-pledge';

      const invite = await service.create('ch-1', 'user-1');

      expect(invite.role).toBe('New Member');
      // Both reads must be scoped to the invite's chapter. Without these the
      // mock ignores its arguments, so passing the wrong id — an invite id,
      // `createdBy`, a cached chapter — would resolve *another* chapter's
      // default onto new invites with the suite still green. Verified by
      // mutation: swapping `chapterId` for a literal here leaves 39/39
      // passing without them.
      expect(mockChapterRepo.findById).toHaveBeenCalledWith('ch-1');
      expect(mockRoleRepo.findByChapter).toHaveBeenCalledWith('ch-1');
    });

    it('lets an explicit role win over the chapter default', async () => {
      chapterDefaultRoleId = 'role-member';

      const invite = await service.create('ch-1', 'user-1', 'New Member');

      expect(invite.role).toBe('New Member');
      // The explicit path short-circuits before any lookup, so naming a role
      // costs neither the roles read nor the chapters read.
      expect(mockRoleRepo.findByChapter).not.toHaveBeenCalled();
    });

    it('reads an older build\'s "Member" as the Everyone role once no role has that name (#4191)', async () => {
      mockRoleRepo.findByChapter.mockResolvedValue([
        role({ name: 'Everyone' }),
        pledgeRole,
      ]);
      await expect(
        service.create('ch-1', 'user-1', 'Member'),
      ).resolves.toMatchObject({ role: 'Everyone' });

      // A role the chapter still calls Member keeps the name.
      mockRoleRepo.findByChapter.mockResolvedValue([
        role({ name: 'Everyone' }),
        role({ id: 'role-custom', name: 'Member', system_key: null }),
      ]);
      await expect(
        service.create('ch-1', 'user-1', 'Member'),
      ).resolves.toMatchObject({ role: 'Member' });
    });

    it('falls back to the seeded Member role when no default is configured', async () => {
      chapterDefaultRoleId = null;

      const invite = await service.create('ch-1', 'user-1');

      expect(invite.role).toBe('Member');
    });

    /*
     * `@IsString()` accepts `""`, and an empty role name matches no row at
     * redeem time — so passing it through would silently demote the invite to
     * the Member fallback, which is the arbitrary-default failure this issue
     * exists to remove, reached by another route.
     */
    it('treats a blank role as "not named" rather than passing it through', async () => {
      chapterDefaultRoleId = 'role-pledge';

      const invite = await service.create('ch-1', 'user-1', '   ');

      expect(invite.role).toBe('New Member');
    });

    /*
     * `on delete set null` should make this unreachable, but a stale read can
     * race a concurrent role delete. Falling back beats issuing an invite
     * whose role is `undefined`.
     */
    it('falls back to Member when the configured default no longer resolves', async () => {
      chapterDefaultRoleId = 'role-deleted';

      const invite = await service.create('ch-1', 'user-1');

      expect(invite.role).toBe('Member');
    });

    it('rejects with 400 when nothing resolves', async () => {
      chapterDefaultRoleId = null;
      mockRoleRepo.findByChapter.mockResolvedValue([pledgeRole]);

      await expect(service.create('ch-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('applies the default to batch and bulk-email creation too', async () => {
      chapterDefaultRoleId = 'role-pledge';

      const batch = await service.createBatch('ch-1', 'user-1', undefined, 2);
      expect(batch.map((invite) => invite.role)).toEqual([
        'New Member',
        'New Member',
      ]);

      mockEmailProvider.sendInviteEmail.mockResolvedValue(true);
      const bulk = await service.createWithEmails('ch-1', 'user-1', undefined, [
        'a@example.com',
      ]);
      expect(bulk.invites[0].role).toBe('New Member');
      // The emailed copy names the resolved role, not an empty string.
      expect(mockEmailProvider.sendInviteEmail).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'New Member' }),
      );
    });
  });
});
