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
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import {
  DEAD_INVITE_DETAILS_DAYS,
  InviteService,
  NO_BASE_ROLE_JOIN_BODY,
  inviteStatus,
  verifiedEmailOf,
} from './invite.service';
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
import type { RankContext } from '#domain/utils/rank-context';
import {
  CHAPTER_ID,
  TIER,
  USER,
  tieredChapterRoles,
  tieredRankContext,
} from '#test/helpers/tiered-chapter.fixture';
import { ActivationService } from './activation.service';
import { LegalAcceptanceService } from './legal-acceptance.service';
import { ConfigService } from '@nestjs/config';
import { EMAIL_PROVIDER } from '#domain/adapters/email.interface';
import type { IEmailProvider } from '#domain/adapters/email.interface';
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
  let mockChapterRepo: jest.Mocked<IChapterRepository>;
  let mockLegalAcceptance: jest.Mocked<
    Pick<LegalAcceptanceService, 'requireOrAccept'>
  >;
  /** Backs `chapters.default_invite_role_id` for the mock above (#422). */
  let chapterDefaultRoleId: string | null;

  beforeEach(async () => {
    captureException.mockClear();
    mockInviteRepo = {
      findById: jest.fn(),
      findByToken: jest.fn(),
      findByChapter: jest.fn(),
      findChapterLinks: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      createMany: jest.fn(),
      markRevoked: jest.fn().mockResolvedValue(undefined),
      revokePending: jest.fn().mockResolvedValue(undefined),
      findPendingByEmail: jest.fn().mockResolvedValue([]),
      // Emailed invites are inserted through `createEmailed`, which also
      // counts the daily ceilings. This one finds room and inserts the rows
      // through `createMany`, so a test reads the rows either path inserted
      // from the same mock; the ceiling tests answer `over` themselves.
      createEmailed: jest.fn(async (batch) => ({
        outcome: 'ok' as const,
        invites: await mockInviteRepo.createMany(
          batch.invites.map((invite) => ({
            ...invite,
            chapter_id: batch.chapterId,
            created_by: batch.createdBy,
          })),
        ),
      })),
      markEmailFailed: jest.fn().mockResolvedValue(undefined),
      markUsedAtomically: jest.fn(),
      releaseClaim: jest.fn().mockResolvedValue(true),
    };

    mockMemberRepo = {
      completeOnboarding: jest.fn(),
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
      setSelfAssignedRole: jest.fn(),
      countByChapter: jest.fn(),
    };

    mockRoleRepo = {
      findById: jest.fn(),
      // The chapter's Member role unless a test says otherwise: invites
      // naming no role the chapter has are refused (#1830).
      findByChapter: jest.fn().mockResolvedValue([
        roleFixture({
          id: 'role-member',
          chapter_id: 'ch-1',
          name: 'Member',
          system_key: SystemRoleKeys.EVERYONE,
          is_system: true,
        }),
      ]),
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
      // (#4071) lets every role but the President's through. The chapter's
      // roles are whatever `mockRoleRepo.findByChapter` answers, read through
      // its implementation so the service's own role reads stay countable.
      getRankContext: jest.fn(async (chapterId: string, _userId: string) => ({
        reach: {
          memberId: 'member-president',
          rank: 0,
          permissions: new Set(['*']),
          wildcard: true,
        },
        roles:
          (await mockRoleRepo.findByChapter.getMockImplementation()?.(
            chapterId,
          )) ?? [],
        tiers: [],
        positions: new Map(),
      })),
    };

    mockEmailProvider = { sendInviteEmail: jest.fn().mockResolvedValue(true) };
    mockConfig = { get: jest.fn().mockReturnValue(undefined) };

    mockUserRepo = {
      findById: jest.fn().mockResolvedValue(null),
      findByIds: jest.fn().mockResolvedValue([]),
      findDisplayIdentitiesByIds: jest.fn(),
      findContactsByIds: jest.fn(),
      findSharedBirthdaysByIds: jest.fn(),
      findBySupabaseAuthId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      anonymize: jest.fn(),
      compareAndSetWhatsNewSeen: jest.fn(),
    };
    // #422: `resolveInviteRole` reads `chapters.default_invite_role_id`
    // through the chapter repository whenever the caller does not name a
    // role. Defaults to "no default configured", which is the pre-#422 world
    // every other test in this file assumes.
    chapterDefaultRoleId = null;
    mockChapterRepo = {
      findById: jest.fn(),
      findByIds: jest.fn(),
      findStartedAtByUserSince: jest.fn().mockResolvedValue([]),
      isAnalyticsOptedOut: jest.fn(),
      findWithBirthdayChannel: jest.fn(),
      findForRecapPush: jest.fn(),
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
        { provide: EMAIL_PROVIDER, useValue: mockEmailProvider },
        { provide: ConfigService, useValue: mockConfig },
        { provide: LegalAcceptanceService, useValue: mockLegalAcceptance },
        { provide: RbacService, useValue: mockRbac },
      ],
    }).compile();

    service = module.get(InviteService);
  });

  /** A live invite into ch-1 as Member: unused, unrevoked, valid for 24h. */
  function inviteRow(overrides: Partial<Invite> = {}): Invite {
    return {
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
      email_failed_at: null,
      reusable: false,
      ...overrides,
    };
  }

  /**
   * The row the repository returns for one create input: the input's token,
   * chapter, role, expiry, sender and address, unused.
   */
  function storedInvite(data: Partial<Invite>, id: string): Invite {
    return inviteRow({
      id,
      token: data.token!,
      chapter_id: data.chapter_id!,
      role: data.role!,
      expires_at: data.expires_at!,
      created_by: data.created_by!,
      email: data.email ?? null,
      reusable: data.reusable ?? false,
    });
  }

  /** The chapter's seeded Member role, as the redeem tests resolve it. */
  function seededMemberRole(overrides: Partial<Role> = {}): Role {
    return roleFixture({
      id: 'role-member',
      name: 'Member',
      system_key: SystemRoleKeys.EVERYONE,
      is_system: true,
      display_order: 3,
      ...overrides,
    });
  }

  /** A live invite redeemed by user-2, who already belongs to ch-1. */
  function arrangeExistingMember(): void {
    mockInviteRepo.findByToken.mockResolvedValue(inviteRow());
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(
      memberFixture({
        user_id: 'user-2',
        role_ids: ['role-1'],
        has_completed_onboarding: true,
      }),
    );
  }

  /**
   * A redeem that reaches the membership insert: the token finds `invite`,
   * the caller is not yet a member, the claim succeeds, and the chapter has
   * `roles`. `member` is what the insert returns, when the test needs one.
   */
  function arrangeRedeem({
    invite = inviteRow(),
    roles = [],
    member,
  }: { invite?: Invite; roles?: Role[]; member?: Member } = {}): void {
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
    mockInviteRepo.markUsedAtomically.mockResolvedValue(
      '2026-01-01T00:00:00.000Z',
    );
    mockRoleRepo.findByChapter.mockResolvedValue(roles);
    if (member) mockMemberRepo.create.mockResolvedValue(member);
  }

  it('should create invite with 24h expiry (no billing check in the service; gating is ChapterGuard)', async () => {
    mockInviteRepo.create.mockImplementation((data) =>
      Promise.resolve(storedInvite(data, 'inv-1')),
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
    // Seven days (Paul 2026-11-19, #5625), not the old 24 hours.
    expect(expiresAt.getTime() - now.getTime()).toBeGreaterThan(
      7 * 24 * 60 * 60 * 1000 - 5000,
    );
    expect(expiresAt.getTime() - now.getTime()).toBeLessThanOrEqual(
      7 * 24 * 60 * 60 * 1000 + 5000,
    );
    expect(result.token).toBe(createCall.token);
  });

  it('should create batch invites using createMany', async () => {
    mockInviteRepo.createMany.mockImplementation((data) =>
      Promise.resolve(data.map((d, i) => storedInvite(d, `inv-${i + 1}`))),
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
        Promise.resolve(data.map((d, i) => storedInvite(d, `inv-${i + 1}`))),
      );
    });

    describe('daily emailed-invite ceilings', () => {
      const HOUR = 60 * 60 * 1000;
      /** `count` emailed invites made `hoursAgo`. */
      const sentAgo = (count: number, hoursAgo: number) =>
        Array.from({ length: count }, () =>
          new Date(Date.now() - hoursAgo * HOUR).toISOString(),
        );
      const emails = (count: number) =>
        Array.from({ length: count }, (_, i) => `m${i}@example.com`);
      /** The database's answer for a batch that doesn't fit. */
      const over = (chapter: string[], inviter: string[]) =>
        mockInviteRepo.createEmailed.mockResolvedValueOnce({
          outcome: 'over',
          chapter,
          inviter,
        });
      const refusalOf = async (promise: Promise<unknown>) => {
        const error = (await promise.catch((e: unknown) => e)) as HttpException;
        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(429);
        return error.getResponse() as { code: string; message: string };
      };

      it('lets a new president email a whole 150-member chapter on day one', async () => {
        // Three batches of 50, the most the dialog sends at once.
        for (let batch = 0; batch < 3; batch++) {
          await expect(
            service.createWithEmails('ch-1', 'user-1', 'Member', emails(50)),
          ).resolves.toEqual(expect.objectContaining({ failed: [] }));
        }
        expect(mockEmailProvider.sendInviteEmail).toHaveBeenCalledTimes(150);
        expect(mockInviteRepo.markEmailFailed).toHaveBeenCalledWith('ch-1', []);
      });

      it('asks the database to count the chapter and the sender over 24 hours, at both ceilings', async () => {
        await service.createWithEmails('ch-1', 'user-1', 'Member', emails(2));
        const batch = mockInviteRepo.createEmailed.mock.calls[0][0];
        expect(batch).toEqual(
          expect.objectContaining({
            chapterId: 'ch-1',
            createdBy: 'user-1',
            chapterLimit: 300,
            inviterLimit: 300,
          }),
        );
        expect(batch.invites.map((i) => i.email)).toEqual(emails(2));
        const since = batch.since.getTime();
        expect(Date.now() - since).toBeGreaterThanOrEqual(24 * HOUR - 1000);
        expect(Date.now() - since).toBeLessThanOrEqual(24 * HOUR + 1000);
      });

      it("refuses a batch past the chapter's day, before any email, and says when", async () => {
        over([...sentAgo(10, 19.5), ...sentAgo(280, 1)], []);
        const response = await refusalOf(
          service.createWithEmails('ch-1', 'user-1', 'Member', emails(50)),
        );
        // 290 sent, 10 left; 40 more must age out, the 10 from 19.5 hours ago
        // and then the batch from an hour ago: 23 hours from now.
        expect(response).toEqual({
          code: 'invite.email_daily_limit',
          message:
            'Your chapter can email up to 300 invites in 24 hours and has 10 left. You can send these 50 in about 23 hours, or share an invite link now.',
        });
        expect(mockInviteRepo.createMany).not.toHaveBeenCalled();
        expect(mockEmailProvider.sendInviteEmail).not.toHaveBeenCalled();
      });

      it('refuses the sender past their own day, across chapters, and says when', async () => {
        over([], [...sentAgo(1, 23.75), ...sentAgo(299, 2)]);
        const { message } = await refusalOf(
          service.createWithEmails('ch-2', 'user-1', 'Member', emails(1)),
        );
        expect(message).toBe(
          'You can email up to 300 invites in 24 hours and have none left. You can send this one in about 15 minutes, or share an invite link now.',
        );
      });

      it('names the ceiling that frees up later when both are full', async () => {
        // The chapter's oldest leaves in about 3 hours, the sender's in about
        // 20: the sender waits on their own ceiling.
        over(
          [...sentAgo(1, 21), ...sentAgo(299, 1)],
          [...sentAgo(1, 4), ...sentAgo(299, 1)],
        );
        const first = await refusalOf(
          service.createWithEmails('ch-1', 'user-1', 'Member', emails(1)),
        );
        expect(first.message).toBe(
          'You can email up to 300 invites in 24 hours and have none left. You can send this one in about 20 hours, or share an invite link now.',
        );
        // And the other way round.
        over(
          [...sentAgo(1, 4), ...sentAgo(299, 1)],
          [...sentAgo(1, 21), ...sentAgo(299, 1)],
        );
        const second = await refusalOf(
          service.createWithEmails('ch-1', 'user-1', 'Member', emails(1)),
        );
        expect(second.message).toMatch(
          /^Your chapter can email up to 300 invites .* in about 20 hours,/,
        );
      });

      it('marks the invites whose email failed, so a resend to them fits', async () => {
        mockEmailProvider.sendInviteEmail.mockImplementation(({ to }) =>
          Promise.resolve(to !== 'm1@example.com' && to !== 'm3@example.com'),
        );
        const result = await service.createWithEmails(
          'ch-1',
          'user-1',
          'Member',
          emails(4),
        );
        expect(result.failed).toEqual(['m1@example.com', 'm3@example.com']);
        const stored = (await mockInviteRepo.createMany.mock.results[0]
          .value) as Invite[];
        const idOf = (email: string) =>
          stored.find((invite) => invite.email === email)!.id;
        expect(mockInviteRepo.markEmailFailed).toHaveBeenCalledWith('ch-1', [
          idOf('m1@example.com'),
          idOf('m3@example.com'),
        ]);
      });

      it('still answers the batch when marking the failures fails', async () => {
        mockEmailProvider.sendInviteEmail.mockResolvedValue(false);
        mockInviteRepo.markEmailFailed.mockRejectedValueOnce(new Error('down'));
        const result = await service.createWithEmails(
          'ch-1',
          'user-1',
          'Member',
          emails(2),
        );
        expect(result.failed).toEqual(emails(2));
        expect(result.invites).toHaveLength(2);
      });

      it('counts each address once, as the batch sends it', async () => {
        await service.createWithEmails('ch-1', 'user-1', 'Member', [
          'a@example.com',
          'A@example.com',
        ]);
        expect(
          mockInviteRepo.createEmailed.mock.calls[0][0].invites,
        ).toHaveLength(1);
      });
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
        // Member is the chapter's Everyone role here, which the email
        // doesn't name (#5628).
        role: null,
        validDays: 7,
        chapterName: 'Phi Gamma Delta Tau Nu',
        inviterName: 'Paul Carlson',
      });
      expect(mockEmailProvider.sendInviteEmail).toHaveBeenCalledWith({
        to: 'b@example.com',
        joinUrl: `https://app.frapp.live/join?token=${inviteData[1].token}`,
        role: null,
        validDays: 7,
        chapterName: 'Phi Gamma Delta Tau Nu',
        inviterName: 'Paul Carlson',
      });
      expect(result.invites).toHaveLength(2);
      expect(result.invites[0]).toEqual(
        expect.objectContaining({ status: 'pending' }),
      );
      expect(result.invites[0]).not.toHaveProperty('created_by');
      // The inviter's list names who each invite went to.
      expect(result.invites.map((invite) => invite.email)).toEqual([
        'a@example.com',
        'b@example.com',
      ]);
      expect(result.failed).toEqual([]);
    });

    it("names no role in the email for the chapter's Everyone role, whatever it is called (#5628)", async () => {
      mockRoleRepo.findByChapter.mockResolvedValue([
        roleFixture({
          id: 'r-member',
          name: 'Everyone',
          system_key: SystemRoleKeys.EVERYONE,
        }),
      ]);

      await service.createWithEmails('ch-1', 'user-1', 'Everyone', [
        'a@example.com',
      ]);

      expect(mockEmailProvider.sendInviteEmail).toHaveBeenCalledWith(
        expect.objectContaining({ role: null }),
      );
    });

    it('names a role the chapter gave the invite in the email (#5628)', async () => {
      mockRoleRepo.findByChapter.mockResolvedValue([
        roleFixture({
          id: 'r-member',
          name: 'Everyone',
          system_key: SystemRoleKeys.EVERYONE,
        }),
        roleFixture({
          id: 'r-pledge',
          name: 'Pledge',
          system_key: null,
          is_system: false,
          permissions: ['members:view'],
        }),
      ]);

      await service.createWithEmails('ch-1', 'user-1', 'Pledge', [
        'a@example.com',
      ]);

      expect(mockEmailProvider.sendInviteEmail).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'Pledge', validDays: 7 }),
      );
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
      ) =>
        inviteRow({
          id,
          token: `tok-${id}`,
          expires_at: '2099-01-01',
          used_at,
          created_at: '2023-12-31',
          email,
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
          [...data].reverse().map((d, i) => storedInvite(d, `inv-${i + 1}`)),
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
    mockInviteRepo.create.mockResolvedValue(
      inviteRow({ expires_at: '2099-01-01' }),
    );

    await service.create('ch-1', 'user-1', 'Member');

    expect(mockActivation.record).toHaveBeenCalledWith(
      'ch-1',
      'activation-first-invite-created',
      { batch_size: 1 },
    );
  });

  it('should redeem valid invite', async () => {
    const memberRole = seededMemberRole();
    const member: Member = memberFixture({
      user_id: 'user-2',
      role_ids: [memberRole.id],
    });
    arrangeRedeem({ roles: [memberRole], member });

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
      joined_via_invite_id: 'inv-1',
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
    const invite = (overrides: Partial<Invite> = {}): Invite =>
      inviteRow({
        id: 'inv-p',
        token: 'preview-token',
        expires_at: LIVE_UNTIL,
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
          system_key: SystemRoleKeys.EVERYONE,
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

    describe('details, the card before sign-in (#5625)', () => {
      it('answers a live invite with the card and state live', async () => {
        mockMemberRepo.countByChapter.mockResolvedValue(41);
        await expect(service.details('preview-token')).resolves.toEqual({
          chapter_name: 'FIJI Tau Nu',
          university: 'Rensselaer Polytechnic Institute',
          mark_text: 'FIJI',
          accent_color: '#5b2c83',
          invited_by: 'Paul Carlson',
          role: null,
          expires_at: LIVE_UNTIL,
          state: 'live',
          chapter_id: 'ch-1',
          member_count: 41,
          sent_at: '2024-01-01',
        });
        expect(mockMemberRepo.countByChapter).toHaveBeenCalledWith('ch-1');
        expect(mockInviteRepo.markUsedAtomically).not.toHaveBeenCalled();
      });

      it.each([
        [
          'expired',
          invite({ expires_at: '2020-01-01T00:00:00.000Z' }),
          'expired',
        ],
        ['used', invite({ used_at: '2024-01-02' }), 'used'],
        [
          'revoked',
          invite({ used_at: '2024-01-02', revoked_at: '2024-01-02' }),
          'off',
        ],
      ])(
        'still names the chapter and sender for a %s invite, without the count or role',
        async (_label, found, state) => {
          mockInviteRepo.findByToken.mockResolvedValue(found);
          mockMemberRepo.countByChapter.mockResolvedValue(41);
          // A few days after it was made: inside the dead card's window.
          await expect(
            service.details('preview-token', new Date('2024-01-05')),
          ).resolves.toMatchObject({
            chapter_name: 'FIJI Tau Nu',
            invited_by: 'Paul Carlson',
            state,
            member_count: 0,
            role: null,
          });
          expect(mockMemberRepo.countByChapter).not.toHaveBeenCalled();
        },
      );

      it('answers 404 for a dead invite older than the dead card keeps it', async () => {
        mockInviteRepo.findByToken.mockResolvedValue(
          invite({ expires_at: '2020-01-01T00:00:00.000Z' }),
        );
        await expect(
          service.details(
            'preview-token',
            new Date(
              Date.parse('2024-01-01') +
                (DEAD_INVITE_DETAILS_DAYS + 1) * 24 * 60 * 60 * 1000,
            ),
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('reads a working link into a locked chapter as locked, not live', async () => {
        mockChapterRepo.findById.mockResolvedValue({
          ...chapter({}),
          subscription_status: 'canceled',
        });
        await expect(service.details('preview-token')).resolves.toMatchObject({
          state: 'locked',
          member_count: 0,
        });
      });

      it('still shows a live card when the member count fails', async () => {
        mockMemberRepo.countByChapter.mockRejectedValue(new Error('count'));
        await expect(service.details('preview-token')).resolves.toMatchObject({
          state: 'live',
          member_count: 0,
        });
      });

      it('never calls a chapter link used, however many joined with it', async () => {
        mockInviteRepo.findByToken.mockResolvedValue(
          invite({ reusable: true, used_at: null }),
        );
        expect((await service.details('preview-token')).state).toBe('live');
      });

      it('answers 404 for an unknown token or a gone chapter', async () => {
        mockInviteRepo.findByToken.mockResolvedValueOnce(null);
        await expect(service.details('nope')).rejects.toBeInstanceOf(
          NotFoundException,
        );
        mockChapterRepo.findById.mockResolvedValueOnce(null);
        await expect(service.details('preview-token')).rejects.toBeInstanceOf(
          NotFoundException,
        );
      });

      describe('askForNewLink', () => {
        const dead = invite({ expires_at: '2020-01-01T00:00:00.000Z' });

        beforeEach(() => {
          mockInviteRepo.findByToken.mockResolvedValue(dead);
          // The sender is still in the chapter; the asker isn't.
          mockMemberRepo.findByUserAndChapter.mockImplementation(async (id) =>
            id === dead.created_by ? ({ id: 'm-sender' } as never) : null,
          );
          mockUserRepo.findById.mockImplementation(async (id) =>
            id === 'asker'
              ? userFixture({ id: 'asker', display_name: 'Jake Morris' })
              : userFixture({ id: 'user-1', display_name: 'Paul Carlson' }),
          );
        });

        it("tells the sender, by the asker's name, which chapter it was for", async () => {
          await service.askForNewLink('preview-token', 'asker');
          expect(mockNotificationService.notifyMembers).toHaveBeenCalledWith(
            'ch-1',
            [dead.created_by],
            expect.objectContaining({
              title: 'Jake Morris asked for a new invite',
              body: expect.stringContaining('FIJI Tau Nu'),
              category: 'members',
            }),
          );
        });

        it('tells nobody when the sender has left the chapter', async () => {
          mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
          await expect(
            service.askForNewLink('preview-token', 'asker'),
          ).resolves.toBeUndefined();
          expect(mockNotificationService.notifyMembers).not.toHaveBeenCalled();
        });

        it('tells the sender the chapter is locked, not that the link died', async () => {
          mockInviteRepo.findByToken.mockResolvedValue(invite());
          mockChapterRepo.findById.mockResolvedValue({
            ...chapter({}),
            subscription_status: 'canceled',
          });
          await service.askForNewLink('preview-token', 'asker');
          expect(mockNotificationService.notifyMembers).toHaveBeenCalledWith(
            'ch-1',
            [dead.created_by],
            expect.objectContaining({
              title: 'Jake Morris tried to join with your invite',
            }),
          );
        });

        it('refuses a link that still works', async () => {
          mockInviteRepo.findByToken.mockResolvedValue(invite());
          await expect(
            service.askForNewLink('preview-token', 'asker'),
          ).rejects.toBeInstanceOf(ConflictException);
          expect(mockNotificationService.notifyMembers).not.toHaveBeenCalled();
        });

        it('refuses someone already in the chapter', async () => {
          mockMemberRepo.findByUserAndChapter.mockResolvedValue({
            id: 'm-1',
          } as never);
          await expect(
            service.askForNewLink('preview-token', 'asker'),
          ).rejects.toBeInstanceOf(ConflictException);
          expect(mockNotificationService.notifyMembers).not.toHaveBeenCalled();
        });
      });
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
    const invite = (overrides: Partial<Invite> = {}): Invite =>
      inviteRow({
        id: 'inv-m',
        token: 'mine-token',
        expires_at: LIVE_UNTIL,
        created_at: '2026-11-08T00:00:00Z',
        email: 'Alice@School.edu',
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
          system_key: SystemRoleKeys.EVERYONE,
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
    const liveInvite = (): Invite =>
      inviteRow({
        id: 'inv-locked',
        token: 'locked-token',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
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
      arrangeRedeem({
        invite: liveInvite(),
        member: memberFixture({ id: 'member-x', user_id: 'user-2' }),
      });
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
    const liveInvite = (): Invite =>
      inviteRow({
        id: 'inv-terms',
        token: 'terms-token',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
    const refusal = () =>
      new ForbiddenException({
        code: 'legal.acceptance_required',
        message:
          'Agree to the Terms of Service and Privacy Policy to continue.',
      });

    beforeEach(() => {
      arrangeRedeem({
        invite: liveInvite(),
        member: memberFixture({ id: 'member-t', user_id: 'user-2' }),
      });
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

  /**
   * The join notices go out when the new member first finishes onboarding
   * (#5627), not at redeem: redeem, then finish, as the clients do.
   */
  async function redeemThenFinish(
    token = 'test-uuid',
    userId = 'user-2',
    inviterLeft = false,
    roleIds?: string[],
  ) {
    const result = await service.redeem(token, userId);
    const used = (await mockInviteRepo.findByToken.mock.results.at(-1)
      ?.value) as Invite;
    expect(mockNotificationService.notifyMembers).not.toHaveBeenCalled();
    mockInviteRepo.findById.mockResolvedValue(used);
    // The inviter is still in the chapter unless a test says otherwise.
    if (!inviterLeft) {
      mockMemberRepo.findByUserAndChapter.mockImplementation(async (uid) =>
        uid === used.created_by ? memberFixture({ user_id: uid }) : null,
      );
    } else {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
    }
    await service.announceJoin({
      user_id: userId,
      chapter_id: used.chapter_id,
      joined_via_invite_id: used.id,
      role_ids: roleIds,
    });
    return result;
  }

  describe("the inviter's notice (#596, #5625, #5627)", () => {
    const memberRole = seededMemberRole();
    const member: Member = memberFixture({
      user_id: 'user-2',
      role_ids: [memberRole.id],
    });

    beforeEach(() => {
      arrangeRedeem({ roles: [memberRole], member });
      mockUserRepo.findByIds.mockResolvedValue([
        userFixture({ id: 'user-2', display_name: 'Alex Chen' }),
      ]);
      mockRbac.findUserIdsWithAnyPermissions.mockResolvedValue([]);
    });

    it('sends nothing at redeem, and keeps the invite for the finish (#5627)', async () => {
      await service.redeem('test-uuid', 'user-2');

      expect(mockNotificationService.notifyMembers).not.toHaveBeenCalled();
      expect(mockMemberRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ joined_via_invite_id: 'inv-1' }),
      );
    });

    it('announces nobody who came in without an invite', async () => {
      await service.announceJoin({
        user_id: 'user-2',
        chapter_id: 'ch-1',
        joined_via_invite_id: null,
      });

      expect(mockInviteRepo.findById).not.toHaveBeenCalled();
      expect(mockNotificationService.notifyMembers).not.toHaveBeenCalled();
    });

    it('tells the inviter their invite was accepted, as a notification and never a DM', async () => {
      await redeemThenFinish();

      expect(mockNotificationService.notifyMembers).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.notifyMembers).toHaveBeenCalledWith(
        'ch-1',
        ['user-1'],
        {
          title: 'Alex Chen accepted your invite',
          body: 'Say hi from their profile in Members.',
          priority: 'NORMAL',
          category: 'members',
          data: { target: { screen: 'members' }, memberUserId: 'user-2' },
        },
      );
    });

    it('tells no inviter who has left the chapter since', async () => {
      await redeemThenFinish('test-uuid', 'user-2', true);

      expect(mockNotificationService.notifyMembers).not.toHaveBeenCalledWith(
        'ch-1',
        ['user-1'],
        expect.anything(),
      );
    });

    it('names the chapter link when that is what they joined with', async () => {
      mockInviteRepo.findByToken.mockResolvedValue(
        inviteRow({ reusable: true }),
      );

      await redeemThenFinish();

      expect(mockNotificationService.notifyMembers).toHaveBeenCalledWith(
        'ch-1',
        ['user-1'],
        expect.objectContaining({
          title: 'Alex Chen joined with your chapter link',
        }),
      );
    });

    it('tells the inviter once, not also as an officer', async () => {
      mockRbac.findUserIdsWithAnyPermissions.mockResolvedValue([
        'user-1',
        'user-officer',
      ]);

      await redeemThenFinish();

      expect(mockNotificationService.notifyMembers).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.notifyMembers).toHaveBeenCalledWith(
        'ch-1',
        ['user-1'],
        expect.objectContaining({ title: 'Alex Chen accepted your invite' }),
      );
      expect(mockNotificationService.notifyMembers).toHaveBeenCalledWith(
        'ch-1',
        ['user-officer'],
        expect.objectContaining({ title: 'Alex Chen joined' }),
      );
    });

    it('tells nobody about themselves on a rejoin with their own invite', async () => {
      mockInviteRepo.findByToken.mockResolvedValue(
        inviteRow({ created_by: 'user-2' }),
      );

      const result = await redeemThenFinish();

      expect(result).toEqual({ chapterId: 'ch-1', memberId: 'member-1' });
      expect(mockNotificationService.notifyMembers).not.toHaveBeenCalled();
    });

    it('still names someone when the new member has no profile yet', async () => {
      mockUserRepo.findByIds.mockResolvedValue([]);

      await redeemThenFinish();

      expect(mockNotificationService.notifyMembers).toHaveBeenCalledWith(
        'ch-1',
        ['user-1'],
        expect.objectContaining({ title: 'Someone accepted your invite' }),
      );
    });
  });

  it('does not record a redemption milestone when the invite is expired (#267)', async () => {
    mockInviteRepo.findByToken.mockResolvedValue(
      inviteRow({ expires_at: '2020-01-01', created_at: '2019-01-01' }),
    );

    await expect(service.redeem('test-uuid', 'user-2')).rejects.toThrow(
      GoneException,
    );
    expect(mockActivation.record).not.toHaveBeenCalled();
  });

  it('should fall back to Member role when invite role not found', async () => {
    const memberRole = seededMemberRole();
    const member: Member = memberFixture({
      user_id: 'user-2',
      role_ids: [memberRole.id],
    });
    arrangeRedeem({
      invite: inviteRow({ role: 'NonExistentRole' }),
      roles: [memberRole],
      member,
    });

    const result = await service.redeem('test-uuid', 'user-2');

    expect(mockMemberRepo.create).toHaveBeenCalledWith({
      user_id: 'user-2',
      chapter_id: 'ch-1',
      role_ids: [memberRole.id],
      joined_via_invite_id: 'inv-1',
    });
    expect(result).toEqual({ chapterId: 'ch-1', memberId: 'member-1' });
  });

  // FRA-320: the fallback used to match the literal name 'Member', so a chapter
  // that relabelled its seeded Member role left redeemers with no role at all.
  it('falls back to the seeded Member role even after it is renamed', async () => {
    const renamedMemberRole = seededMemberRole({ name: 'Active Brother' });
    arrangeRedeem({
      invite: inviteRow({ role: 'NonExistentRole' }),
      roles: [renamedMemberRole],
    });
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

  // Every join holds the Everyone role, the floor (Paul, 2026-11-21): the
  // invite's role, then Everyone, and nothing else, so a join into a role
  // carrying no access lands with only what the whole chapter may see.
  describe('a join holds the invite role and Everyone', () => {
    const memberRole: Role = roleFixture({
      id: 'role-member',
      name: 'Everyone',
      system_key: SystemRoleKeys.EVERYONE,
      is_system: true,
      display_order: 8,
      permissions: ['members:view'],
    });
    const activesRole: Role = roleFixture({
      id: 'role-actives',
      name: 'Actives',
      system_key: SystemRoleKeys.MEMBER,
      is_system: true,
      display_order: 5,
      permissions: ['members:view', 'events:create'],
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
      return inviteRow({ role });
    }

    beforeEach(() => {
      // Each test names the invite it redeems.
      arrangeRedeem({
        roles: [memberRole, activesRole, cabinetRole, newMemberRole],
        member: memberFixture(),
      });
    });

    it('adds Everyone after a role that carries no access, never Actives', async () => {
      mockInviteRepo.findByToken.mockResolvedValue(inviteFor('Cabinet'));

      await service.redeem('test-uuid', 'user-2');

      // The invited role stays first: web's Members list labels by role_ids[0].
      expect(mockMemberRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role_ids: ['role-cabinet', 'role-member'],
        }),
      );
    });

    it('adds Everyone after a base role', async () => {
      mockInviteRepo.findByToken.mockResolvedValue(inviteFor('New Member'));

      await service.redeem('test-uuid', 'user-2');

      expect(mockMemberRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role_ids: ['role-new-member', 'role-member'],
        }),
      );
    });

    it('joins with Everyone alone from an invite naming Everyone', async () => {
      mockInviteRepo.findByToken.mockResolvedValue(inviteFor('Everyone'));

      await service.redeem('test-uuid', 'user-2');

      expect(mockMemberRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ role_ids: ['role-member'] }),
      );
    });

    it('grants only the custom role when the chapter has no Everyone role', async () => {
      mockRoleRepo.findByChapter.mockResolvedValue([cabinetRole]);
      mockInviteRepo.findByToken.mockResolvedValue(inviteFor('Cabinet'));

      await service.redeem('test-uuid', 'user-2');

      expect(mockMemberRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ role_ids: ['role-cabinet'] }),
      );
    });
  });

  it('should reject expired invite', async () => {
    mockInviteRepo.findByToken.mockResolvedValue(
      inviteRow({ expires_at: new Date(Date.now() - 1000).toISOString() }),
    );

    const promise = service.redeem('test-uuid', 'user-2');
    await expect(promise).rejects.toThrow(GoneException);
    await expect(promise).rejects.toThrow('Invite expired');
    expect(mockMemberRepo.create).not.toHaveBeenCalled();
  });

  it('should reject used invite', async () => {
    mockInviteRepo.findByToken.mockResolvedValue(
      inviteRow({ used_at: '2024-01-02' }),
    );

    const promise = service.redeem('test-uuid', 'user-2');
    await expect(promise).rejects.toThrow(GoneException);
    await expect(promise).rejects.toThrow('Invite already used');
    expect(mockMemberRepo.create).not.toHaveBeenCalled();
  });

  it('should reject if user already member', async () => {
    arrangeExistingMember();

    const promise = service.redeem('test-uuid', 'user-2');
    await expect(promise).rejects.toThrow(ConflictException);
    await expect(promise).rejects.toThrow('Already a member of this chapter');
    expect(mockInviteRepo.markUsedAtomically).not.toHaveBeenCalled();
    expect(mockMemberRepo.create).not.toHaveBeenCalled();
  });

  it('should list invites by chapter', async () => {
    const invites: Invite[] = [
      inviteRow({ token: 'token-1', expires_at: '2024-01-02' }),
    ];
    mockInviteRepo.findByChapter.mockResolvedValue(invites);

    const result = await service.findByChapter('ch-1', 'user-1');

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
        reusable: false,
      },
    ]);
  });

  describe('inviteStatus (#3607)', () => {
    const NOW = new Date('2026-11-06T12:00:00.000Z');
    const base: Invite = inviteRow({
      token: 't',
      expires_at: '2026-11-07T12:00:00.000Z',
      created_at: '2026-11-06T11:00:00.000Z',
    });

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
    const memberRole = seededMemberRole();
    let member: Member;

    beforeEach(() => {
      member = memberFixture({
        user_id: 'user-2',
        role_ids: [memberRole.id],
      });
      arrangeRedeem({ roles: [memberRole], member });
      mockUserRepo.findByIds.mockResolvedValue([
        userFixture({ id: 'user-2', display_name: 'Alex Smith' }),
      ]);
    });

    it('names the new member to whoever can act on a join', async () => {
      mockRbac.findUserIdsWithAnyPermissions.mockResolvedValue([
        'user-1',
        'user-officer',
      ]);

      await redeemThenFinish();

      expect(mockRbac.findUserIdsWithAnyPermissions).toHaveBeenCalledWith(
        'ch-1',
        MEMBER_JOINED_AUDIENCE,
      );
      // `user-1` sent the invite, so hears it as theirs instead (#5625).
      expect(mockNotificationService.notifyMembers).toHaveBeenCalledWith(
        'ch-1',
        ['user-officer'],
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

    it('tells the officers when the new member holds no base role (#5802)', async () => {
      const actives = roleFixture({
        id: 'role-actives',
        chapter_id: 'ch-1',
        name: 'Actives',
        system_key: SystemRoleKeys.MEMBER,
        is_system: true,
      });
      mockRoleRepo.findByChapter.mockResolvedValue([memberRole, actives]);
      mockRbac.findUserIdsWithAnyPermissions.mockResolvedValue([
        'user-officer',
      ]);

      await redeemThenFinish('test-uuid', 'user-2', false, [memberRole.id]);
      expect(mockNotificationService.notifyMembers).toHaveBeenCalledWith(
        'ch-1',
        ['user-officer'],
        expect.objectContaining({ body: NO_BASE_ROLE_JOIN_BODY }),
      );

      mockNotificationService.notifyMembers.mockClear();
      await service.announceJoin({
        user_id: 'user-2',
        chapter_id: 'ch-1',
        joined_via_invite_id: 'inv-1',
        role_ids: ['ROLE-ACTIVES', memberRole.id],
      });
      expect(mockNotificationService.notifyMembers).toHaveBeenCalledWith(
        'ch-1',
        ['user-officer'],
        expect.objectContaining({ body: 'New member of the chapter' }),
      );
    });

    it('never pushes the member who joined, even when they could act on it', async () => {
      mockRbac.findUserIdsWithAnyPermissions.mockResolvedValue([
        'user-2',
        'user-officer',
      ]);

      await redeemThenFinish();

      expect(mockNotificationService.notifyMembers).toHaveBeenCalledWith(
        'ch-1',
        ['user-officer'],
        expect.objectContaining({ title: 'Alex Smith joined' }),
      );
      for (const [, recipients] of mockNotificationService.notifyMembers.mock
        .calls) {
        expect(recipients).not.toContain('user-2');
      }
    });

    it('tells only the inviter when nobody else can act on a join', async () => {
      mockRbac.findUserIdsWithAnyPermissions.mockResolvedValue(['user-2']);

      await expect(redeemThenFinish()).resolves.toEqual({
        chapterId: 'ch-1',
        memberId: member.id,
      });

      expect(mockNotificationService.notifyMembers).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.notifyMembers).toHaveBeenCalledWith(
        'ch-1',
        ['user-1'],
        expect.objectContaining({ title: 'Alex Smith accepted your invite' }),
      );
    });

    it('still redeems, and reports once, when sending the push fails', async () => {
      mockRbac.findUserIdsWithAnyPermissions.mockResolvedValue(['user-1']);
      mockNotificationService.notifyMembers.mockRejectedValue(
        new Error('push delivery failed'),
      );
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(redeemThenFinish()).resolves.toEqual({
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

    it("still redeems, still tells the inviter, and reports once, when the officers' roster read fails", async () => {
      mockRbac.findUserIdsWithAnyPermissions.mockRejectedValue(
        new Error('roster read failed'),
      );
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(redeemThenFinish()).resolves.toEqual({
        chapterId: 'ch-1',
        memberId: member.id,
      });

      // The inviter's notice doesn't need the roster, so it still goes out.
      expect(mockNotificationService.notifyMembers).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.notifyMembers).toHaveBeenCalledWith(
        'ch-1',
        ['user-1'],
        expect.objectContaining({ title: 'Alex Smith accepted your invite' }),
      );
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
    arrangeRedeem();
    mockInviteRepo.markUsedAtomically.mockResolvedValue(null);

    const promise = service.redeem('test-uuid', 'user-2');
    await expect(promise).rejects.toThrow(GoneException);
    await expect(promise).rejects.toThrow('Invite already used');
  });

  it('releases the claim when membership insert fails after markUsedAtomically (#1863)', async () => {
    const insertError = new Error('members_user_id_chapter_id_key');
    arrangeRedeem();
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
    arrangeRedeem();
    // Not a member at the pre-check, but the row is there once the insert fails.
    mockMemberRepo.findByUserAndChapter
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        memberFixture({
          user_id: 'user-2',
        }),
      );
    mockMemberRepo.create.mockRejectedValue(new Error('response dropped'));

    await expect(service.redeem('test-uuid', 'user-2')).rejects.toThrow(
      'response dropped',
    );
    expect(mockInviteRepo.releaseClaim).not.toHaveBeenCalled();
    expect(mockActivation.record).not.toHaveBeenCalled();
  });

  it('does not release the claim when the post-failure membership lookup throws (#1863)', async () => {
    const insertError = new Error('insert failed');
    arrangeRedeem();
    mockMemberRepo.findByUserAndChapter
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('lookup failed'));
    mockMemberRepo.create.mockRejectedValue(insertError);

    await expect(service.redeem('test-uuid', 'user-2')).rejects.toBe(
      insertError,
    );
    expect(mockInviteRepo.releaseClaim).not.toHaveBeenCalled();
  });

  it('still throws the insert error when releaseClaim itself fails (#1863)', async () => {
    const insertError = new Error('insert failed');
    arrangeRedeem();
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
    const lookupError = new Error('roles unavailable');
    arrangeRedeem();
    mockRoleRepo.findByChapter.mockRejectedValue(lookupError);

    await expect(service.redeem('test-uuid', 'user-2')).rejects.toBe(
      lookupError,
    );
    expect(mockInviteRepo.markUsedAtomically).not.toHaveBeenCalled();
    expect(mockMemberRepo.create).not.toHaveBeenCalled();
    expect(mockInviteRepo.releaseClaim).not.toHaveBeenCalled();
  });

  it('does not release a claim when membership insert succeeds', async () => {
    arrangeRedeem();
    mockMemberRepo.create.mockResolvedValue(
      memberFixture({
        user_id: 'user-2',
      }),
    );

    await service.redeem('test-uuid', 'user-2');

    expect(mockInviteRepo.releaseClaim).not.toHaveBeenCalled();
  });

  it('should create member without roles if no matching role and no Member role found', async () => {
    arrangeRedeem({ invite: inviteRow({ role: 'Admin' }) });
    mockMemberRepo.create.mockResolvedValue({} as any);

    await service.redeem('test-uuid', 'user-2');

    expect(mockMemberRepo.create).toHaveBeenCalledWith({
      user_id: 'user-2',
      chapter_id: 'ch-1',
      role_ids: [],
      joined_via_invite_id: 'inv-1',
    });
  });

  it('should reject if existing member redeeming invite in InviteService', async () => {
    arrangeExistingMember();

    const promise = service.redeem('test-uuid', 'user-2');
    await expect(promise).rejects.toThrow(ConflictException);
    await expect(promise).rejects.toThrow('Already a member of this chapter');
    expect(mockMemberRepo.findByUserAndChapter).toHaveBeenCalledWith(
      'user-2',
      'ch-1',
    );
  });

  // Paul, 2026-11-19: "One chapter link, 7 days".
  describe('chapter link (#3353)', () => {
    const memberRole = seededMemberRole();

    beforeEach(() => {
      mockRoleRepo.findByChapter.mockResolvedValue([memberRole]);
      mockInviteRepo.create.mockImplementation((data) =>
        Promise.resolve(storedInvite(data, 'link-2')),
      );
    });

    it('makes a reusable link at the default role that lasts 7 days', async () => {
      const before = Date.now();
      const link = await service.createChapterLink('ch-1', 'user-1');

      const data = mockInviteRepo.create.mock.calls[0][0];
      expect(data).toEqual(
        expect.objectContaining({
          chapter_id: 'ch-1',
          role: 'Member',
          reusable: true,
          email: null,
        }),
      );
      const days =
        (new Date(data.expires_at!).getTime() - before) / (24 * 3600 * 1000);
      expect(days).toBeGreaterThan(6.99);
      expect(days).toBeLessThan(7.01);
      expect(link).toEqual(
        expect.objectContaining({ reusable: true, status: 'pending' }),
      );
    });

    it("turns off that role's link before it, and no other role's (#5633)", async () => {
      mockInviteRepo.findChapterLinks.mockResolvedValue([
        inviteRow({ id: 'link-pledge', role: 'Pledge', reusable: true }),
        inviteRow({ id: 'link-1', reusable: true }),
      ]);
      mockRoleRepo.findByChapter.mockResolvedValue([
        memberRole,
        roleFixture({ id: 'role-pledge', name: 'Pledge', display_order: 4 }),
      ]);

      await service.createChapterLink('ch-1', 'user-1');

      expect(mockInviteRepo.markRevoked).toHaveBeenCalledTimes(1);
      expect(mockInviteRepo.markRevoked).toHaveBeenCalledWith('link-1');
      expect(
        mockInviteRepo.markRevoked.mock.invocationCallOrder[0],
      ).toBeLessThan(mockInviteRepo.create.mock.invocationCallOrder[0]);
    });

    // Paul, 2026-11-19: "Officer picks it per link".
    it('makes a link at the role the officer picks, beside the others (#5633)', async () => {
      mockRoleRepo.findByChapter.mockResolvedValue([
        memberRole,
        roleFixture({ id: 'role-pledge', name: 'Pledge', display_order: 4 }),
      ]);
      mockInviteRepo.findChapterLinks.mockResolvedValue([
        inviteRow({ id: 'link-1', reusable: true }),
      ]);

      const link = await service.createChapterLink('ch-1', 'user-1', 'Pledge');

      expect(mockInviteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'Pledge', reusable: true }),
      );
      expect(mockInviteRepo.markRevoked).not.toHaveBeenCalled();
      expect(link).toEqual(expect.objectContaining({ role: 'Pledge' }));
    });

    it('answers 409 when another officer made one at the same moment', async () => {
      mockInviteRepo.create.mockRejectedValue(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );

      await expect(
        service.createChapterLink('ch-1', 'user-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'invite.chapter_link_conflict',
        }),
      });
    });

    it('stays out of the invite list', async () => {
      mockInviteRepo.findByChapter.mockResolvedValue([
        inviteRow({ id: 'link-1', reusable: true }),
        inviteRow({ id: 'inv-1' }),
      ]);

      const rows = await service.findByChapter('ch-1', 'user-1');

      expect(rows.map((row) => row.id)).toEqual(['inv-1']);
    });

    // Phone builds from before #5633 show only `link` and post no body to
    // replace it, which turns off the default role's link: `link` must be that one.
    it("answers `link` as the default role's link, not the newest (#5633)", async () => {
      mockRoleRepo.findByChapter.mockResolvedValue([
        memberRole,
        roleFixture({ id: 'role-pledge', name: 'Pledge', display_order: 4 }),
      ]);
      mockInviteRepo.findChapterLinks.mockResolvedValue([
        inviteRow({ id: 'link-pledge', role: 'Pledge', reusable: true }),
        inviteRow({ id: 'link-1', reusable: true }),
      ]);

      const view = await service.findChapterLinkView('ch-1', 'user-1');

      expect(view.links.map((link) => link.id)).toEqual([
        'link-pledge',
        'link-1',
      ]);
      expect(view.link).toEqual(expect.objectContaining({ id: 'link-1' }));
      expect(view.defaultRole).toBe('Member');
    });

    it('answers no `link` when the default role has none (#5633)', async () => {
      mockRoleRepo.findByChapter.mockResolvedValue([
        memberRole,
        roleFixture({ id: 'role-pledge', name: 'Pledge', display_order: 4 }),
      ]);
      mockInviteRepo.findChapterLinks.mockResolvedValue([
        inviteRow({ id: 'link-pledge', role: 'Pledge', reusable: true }),
      ]);

      const view = await service.findChapterLinkView('ch-1', 'user-1');

      expect(view.links).toHaveLength(1);
      expect(view.link).toBeNull();
    });

    it("reads back every role's link, expired ones included", async () => {
      mockInviteRepo.findChapterLinks.mockResolvedValue([
        inviteRow({ id: 'link-pledge', role: 'Pledge', reusable: true }),
        inviteRow({
          id: 'link-1',
          reusable: true,
          expires_at: '2020-01-01T00:00:00.000Z',
        }),
      ]);

      await expect(service.findChapterLinks('ch-1', 'user-1')).resolves.toEqual(
        [
          expect.objectContaining({ id: 'link-pledge', status: 'pending' }),
          expect.objectContaining({ id: 'link-1', status: 'expired' }),
        ],
      );
    });

    it('lets many people join without using it up', async () => {
      const member = memberFixture({
        user_id: 'user-2',
        role_ids: [memberRole.id],
      });
      arrangeRedeem({
        invite: inviteRow({ reusable: true }),
        roles: [memberRole],
        member,
      });

      await service.redeem('test-uuid', 'user-2');

      expect(mockInviteRepo.markUsedAtomically).not.toHaveBeenCalled();
      expect(mockMemberRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-2', chapter_id: 'ch-1' }),
      );
    });

    it('never releases a claim it did not make when the join fails', async () => {
      arrangeRedeem({
        invite: inviteRow({ reusable: true }),
        roles: [memberRole],
      });
      mockMemberRepo.create.mockRejectedValue(new Error('insert failed'));

      await expect(service.redeem('test-uuid', 'user-2')).rejects.toThrow(
        'insert failed',
      );
      expect(mockInviteRepo.releaseClaim).not.toHaveBeenCalled();
    });

    it('refuses a link an officer turned off', async () => {
      arrangeRedeem({
        invite: inviteRow({
          reusable: true,
          revoked_at: '2026-01-01T00:00:00.000Z',
          used_at: '2026-01-01T00:00:00.000Z',
        }),
        roles: [memberRole],
      });

      await expect(service.redeem('test-uuid', 'user-2')).rejects.toThrow(
        GoneException,
      );
    });
  });

  describe('revoke', () => {
    it('should mark invite as used', async () => {
      mockInviteRepo.findById.mockResolvedValue(inviteRow());

      await service.revoke('inv-1', 'ch-1', 'user-1');

      expect(mockInviteRepo.findById).toHaveBeenCalledWith('inv-1');
      expect(mockInviteRepo.markRevoked).toHaveBeenCalledWith('inv-1');
    });

    it('should reject already-used invite', async () => {
      mockInviteRepo.findById.mockResolvedValue(
        inviteRow({ used_at: '2024-01-02' }),
      );

      await expect(service.revoke('inv-1', 'ch-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.revoke('inv-1', 'ch-1', 'user-1')).rejects.toThrow(
        'Invite has already been used',
      );
      expect(mockInviteRepo.markRevoked).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when invite does not exist', async () => {
      mockInviteRepo.findById.mockResolvedValue(null);

      await expect(service.revoke('inv-x', 'ch-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when invite belongs to different chapter', async () => {
      mockInviteRepo.findById.mockResolvedValue(
        inviteRow({ chapter_id: 'ch-2' }),
      );

      await expect(service.revoke('inv-1', 'ch-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  /**
   * #422. `role` is optional on the three create routes; when it is absent the
   * service resolves the chapter's configured default, then the seeded Member
   * role.
   */
  // #4071, #1830 (Paul, 2026-11-16): an invite grants only a role ranked
  // below the inviter, and never the President's, checked at create and
  // again at redeem.
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

    it("stops a chair inviting a peer: their own tier's role is an equal rank", async () => {
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.riskChair),
      );
      await expect(
        service.create(CHAPTER_ID, USER.riskChair, 'Social chair'),
      ).rejects.toThrow('You can only invite people into a role ranked below');
      // Their own role is no different.
      await expect(
        service.create(CHAPTER_ID, USER.riskChair, 'Risk chair'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockInviteRepo.create).not.toHaveBeenCalled();
    });

    it('lets a chair invite a brother, a role ranked below them', async () => {
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.riskChair),
      );
      await service.create(CHAPTER_ID, USER.riskChair, 'Brother');
      expect(mockInviteRepo.create).toHaveBeenCalledTimes(1);
    });

    it('refuses an equal or higher rank on the batch and email routes too', async () => {
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.vicePresident),
      );
      await expect(
        service.createBatch(
          CHAPTER_ID,
          USER.vicePresident,
          'Vice President',
          2,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.createWithEmails(CHAPTER_ID, USER.vicePresident, 'President', [
          'pat@example.com',
        ]),
      ).rejects.toThrow('An invite cannot grant the President role');
      expect(mockInviteRepo.createMany).not.toHaveBeenCalled();
    });

    it('refuses a role name the chapter has no role for with 400', async () => {
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.president),
      );
      await expect(
        service.create(CHAPTER_ID, USER.president, 'Grand Poobah'),
      ).rejects.toMatchObject({ response: { code: 'invite.role_unknown' } });
      await expect(
        service.create(CHAPTER_ID, USER.president, 'Grand Poobah'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockInviteRepo.create).not.toHaveBeenCalled();
    });

    it("stops an inviter bringing in a role whose permissions they don't hold", async () => {
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.riskChair),
      );
      // Ranked below the chair, but carrying billing:view, which they lack.
      await expect(
        service.create(CHAPTER_ID, USER.riskChair, 'Treasury assistant'),
      ).rejects.toThrow(/billing:view/);
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

    function liveInvite(role: string, createdBy: string): Invite {
      return inviteRow({
        id: 'inv-old',
        token: 'old-token',
        chapter_id: CHAPTER_ID,
        role,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        created_by: createdBy,
      });
    }

    beforeEach(() => {
      // Each redeem test names the invite it redeems.
      arrangeRedeem({
        roles: tieredChapterRoles(),
        member: memberFixture({
          user_id: 'user-joiner',
          chapter_id: CHAPTER_ID,
        }),
      });
    });

    it('refuses to redeem a President invite minted before the rule, leaving the token unused', async () => {
      mockInviteRepo.findByToken.mockResolvedValue(
        liveInvite('President', USER.president),
      );
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.president),
      );

      await expect(
        service.redeem('old-token', 'user-joiner'),
      ).rejects.toMatchObject({
        response: { code: 'invite.role_out_of_reach' },
      });
      // Fails closed: no second President, and no quiet join as someone else.
      expect(mockInviteRepo.markUsedAtomically).not.toHaveBeenCalled();
      expect(mockMemberRepo.create).not.toHaveBeenCalled();
    });

    it("judges the redeem by the inviter's roles now: a demoted chair's invite fails", async () => {
      // The chair sent a Brother invite, then lost the chair role.
      mockInviteRepo.findByToken.mockResolvedValue(
        liveInvite('Brother', USER.riskChair),
      );
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.brother),
      );

      await expect(
        service.redeem('old-token', 'user-joiner'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockRbac.getRankContext).toHaveBeenCalledWith(
        CHAPTER_ID,
        USER.riskChair,
      );
      expect(mockInviteRepo.markUsedAtomically).not.toHaveBeenCalled();
      expect(mockMemberRepo.create).not.toHaveBeenCalled();
    });

    it("refuses an invite equal to the inviter's rank at redeem, as at create", async () => {
      // A row from before the strict rule: a chair's peer invite.
      mockInviteRepo.findByToken.mockResolvedValue(
        liveInvite('Social chair', USER.riskChair),
      );
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.riskChair),
      );

      await expect(
        service.redeem('old-token', 'user-joiner'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockMemberRepo.create).not.toHaveBeenCalled();
    });

    /** The tiered chapter plus its Everyone role, in the brothers' tier. */
    function withEveryone(context: RankContext): RankContext {
      return {
        ...context,
        roles: [
          ...context.roles,
          roleFixture({
            id: 'role-everyone',
            chapter_id: CHAPTER_ID,
            name: 'Everyone',
            system_key: SystemRoleKeys.EVERYONE,
            is_system: true,
            tier_id: TIER.brothers,
            permissions: ['members:view'],
          }),
        ],
      };
    }

    it('refuses an Everyone invite once its sender has left the chapter', async () => {
      mockInviteRepo.findByToken.mockResolvedValue(
        liveInvite('Everyone', 'user-gone'),
      );
      // No membership: holds nothing, so can no longer invite anyone.
      mockRbac.getRankContext.mockResolvedValue(
        withEveryone(tieredRankContext('user-gone')),
      );

      await expect(
        service.redeem('old-token', 'user-joiner'),
      ).rejects.toMatchObject({
        response: { code: 'invite.role_out_of_reach' },
      });
      expect(mockMemberRepo.create).not.toHaveBeenCalled();
    });

    it("lets a member ranked with Everyone invite into it, but not into a peer's role", async () => {
      // A brother the chapter gave members:invite: Everyone sits in their own
      // tier, but it is the floor every member holds, so it stays invitable.
      const context = withEveryone(tieredRankContext(USER.brother));
      mockRbac.getRankContext.mockResolvedValue({
        ...context,
        reach: {
          ...context.reach,
          permissions: new Set([
            ...context.reach.permissions,
            'members:invite',
          ]),
        },
      });
      mockRoleRepo.findByChapter.mockResolvedValue(context.roles);

      await expect(
        service.create(CHAPTER_ID, USER.brother, 'Everyone'),
      ).resolves.toMatchObject({ role: 'Everyone' });
      await expect(
        service.create(CHAPTER_ID, USER.brother, 'Brother'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        await service.findInvitableRoleIds(CHAPTER_ID, USER.brother),
      ).toContain('role-everyone');
    });

    it('previews a refused invite as the 403 the redeem would give', async () => {
      mockInviteRepo.findByToken.mockResolvedValue(
        liveInvite('President', USER.president),
      );
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.president),
      );
      mockChapterRepo.findById.mockResolvedValue({
        id: CHAPTER_ID,
        name: 'Tiered',
        university: 'State',
        accent_color: null,
        branding: {},
      } as unknown as Chapter);

      await expect(service.preview('old-token')).rejects.toMatchObject({
        response: { code: 'invite.role_out_of_reach' },
      });
    });

    it('offers the older working invite when a newer one would be refused', async () => {
      const older = {
        ...liveInvite('Brother', USER.president),
        id: 'inv-older',
        token: 'older-token',
        email: 'pat@example.com',
      };
      const newer = {
        ...liveInvite('Social chair', USER.riskChair),
        id: 'inv-newer',
        token: 'newer-token',
        email: 'pat@example.com',
      };
      mockInviteRepo.findPendingByEmail.mockResolvedValue([newer, older]);
      mockMemberRepo.findByUser.mockResolvedValue([]);
      mockChapterRepo.findById.mockResolvedValue({
        id: CHAPTER_ID,
        name: 'Tiered',
        university: 'State',
        accent_color: null,
        branding: {},
      } as unknown as Chapter);
      mockRbac.getRankContext.mockImplementation((_chapter, userId) =>
        Promise.resolve(tieredRankContext(userId)),
      );

      const rows = await service.findPendingForVerifiedEmail(
        'pat@example.com',
        'user-joiner',
      );

      expect(rows.map((row) => row.token)).toEqual(['older-token']);
    });

    it('redeems an invite the inviter still outranks', async () => {
      mockInviteRepo.findByToken.mockResolvedValue(
        liveInvite('Brother', USER.riskChair),
      );
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.riskChair),
      );

      await service.redeem('old-token', 'user-joiner');

      expect(mockMemberRepo.create).toHaveBeenCalledWith({
        user_id: 'user-joiner',
        chapter_id: CHAPTER_ID,
        role_ids: ['role-brother'],
        joined_via_invite_id: 'inv-old',
      });
    });
  });

  // #4546 (Paul, 2026-11-13: "no"): officers cannot hand out an invite above
  // their own rank, by minting it or by reusing one a higher officer sent.
  describe('invites above the caller rank stay out of reach (#4546)', () => {
    function pending(id: string, role: string, email: string | null = null) {
      return inviteRow({
        id,
        token: `tok-${id}`,
        chapter_id: CHAPTER_ID,
        role,
        expires_at: '2099-01-01',
        created_by: USER.president,
        created_at: '2026-11-12',
        email,
      });
    }

    const invites = [
      pending('inv-treasurer', 'Treasurer', 'pat@example.com'),
      pending('inv-vp', 'Vice President'),
      pending('inv-social', 'Social chair'),
      pending('inv-brother', 'Brother'),
      pending('inv-assistant', 'Treasury assistant'),
      // A role since deleted: the redeem grants Member, so it lists.
      pending('inv-gone', 'Deleted role'),
      // Minted before #4071: the redeem refuses it (#1830), so it lists as a
      // dead link any inviter can revoke.
      pending('inv-old-president', 'President'),
    ];

    beforeEach(() => {
      mockInviteRepo.findByChapter.mockResolvedValue(invites);
    });

    it("leaves a chair's list without the officers' invites or their links", async () => {
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.riskChair),
      );

      const rows = await service.findByChapter(CHAPTER_ID, USER.riskChair);

      // A brother's lists; a peer's, the board's, and a junior role carrying
      // billing:view the chair lacks, do not.
      expect(rows.map((row) => row.id)).toEqual([
        'inv-brother',
        'inv-gone',
        'inv-old-president',
      ]);
      expect(rows.map((row) => row.token)).not.toContain('tok-inv-treasurer');
    });

    it('lists a peer officer only what they could send themselves', async () => {
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.vicePresident),
      );

      const rows = await service.findByChapter(CHAPTER_ID, USER.vicePresident);

      // Equal rank (the VP's own role, the Treasurer's) does not list.
      expect(rows.map((row) => row.id)).toEqual([
        'inv-social',
        'inv-brother',
        'inv-gone',
        'inv-old-president',
      ]);
    });

    it('lists every invite to the President', async () => {
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.president),
      );

      const rows = await service.findByChapter(CHAPTER_ID, USER.president);

      expect(rows).toHaveLength(invites.length);
    });

    it("shows a chair only the chapter links they could make, and won't make one above them (#5633)", async () => {
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.riskChair),
      );
      mockRoleRepo.findByChapter.mockResolvedValue(tieredChapterRoles());
      mockInviteRepo.findChapterLinks.mockResolvedValue([
        { ...pending('link-vp', 'Vice President'), reusable: true },
        { ...pending('link-brother', 'Brother'), reusable: true },
      ]);

      const links = await service.findChapterLinks(CHAPTER_ID, USER.riskChair);
      expect(links.map((link) => link.id)).toEqual(['link-brother']);

      await expect(
        service.createChapterLink(CHAPTER_ID, USER.riskChair, 'Vice President'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockInviteRepo.create).not.toHaveBeenCalled();
    });

    it("won't let a chair revoke an officer's invite", async () => {
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.riskChair),
      );
      mockInviteRepo.findById.mockResolvedValue(invites[0]);

      await expect(
        service.revoke('inv-treasurer', CHAPTER_ID, USER.riskChair),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockInviteRepo.markRevoked).not.toHaveBeenCalled();
    });

    it('lets a chair revoke a brother invite', async () => {
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.riskChair),
      );
      mockInviteRepo.findById.mockResolvedValue(invites[3]);

      await service.revoke('inv-brother', CHAPTER_ID, USER.riskChair);

      expect(mockInviteRepo.markRevoked).toHaveBeenCalledWith('inv-brother');
    });

    it("keeps the President's invite live when a chair emails the same address", async () => {
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.riskChair),
      );
      mockRoleRepo.findByChapter.mockResolvedValue(tieredChapterRoles());
      mockInviteRepo.createMany.mockImplementation((rows) =>
        Promise.resolve(
          (rows as Invite[]).map((row, i) => ({ ...row, id: `new-${i}` })),
        ),
      );

      await service.createWithEmails(CHAPTER_ID, USER.riskChair, 'Brother', [
        'pat@example.com',
      ]);

      expect(mockInviteRepo.revokePending).toHaveBeenCalledWith([]);
    });

    it('swaps a chapter default above the sender for Everyone, but never a named role', async () => {
      const everyone = roleFixture({
        id: 'role-everyone',
        chapter_id: CHAPTER_ID,
        name: 'Everyone',
        system_key: SystemRoleKeys.EVERYONE,
        is_system: true,
        permissions: ['members:view'],
      });
      const roles = [...tieredChapterRoles(), everyone];
      mockRoleRepo.findByChapter.mockResolvedValue(roles);
      mockRbac.getRankContext.mockResolvedValue({
        ...tieredRankContext(USER.riskChair),
        roles,
      });
      mockInviteRepo.create.mockImplementation((data) =>
        Promise.resolve(data as Invite),
      );
      chapterDefaultRoleId = 'role-vp';

      // The phone names no role: the chair still sends a working invite.
      const invite = await service.create(CHAPTER_ID, USER.riskChair);
      expect(invite.role).toBe('Everyone');

      await expect(
        service.create(CHAPTER_ID, USER.riskChair, 'Vice President'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('offers each officer only the roles they may invite into', async () => {
      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.riskChair),
      );
      expect(
        await service.findInvitableRoleIds(CHAPTER_ID, USER.riskChair),
      ).toEqual(['role-brother', 'role-pledge']);

      mockRbac.getRankContext.mockResolvedValue(
        tieredRankContext(USER.president),
      );
      // Everything but the President's own role, which no invite grants.
      expect(
        await service.findInvitableRoleIds(CHAPTER_ID, USER.president),
      ).not.toContain('role-president');
      expect(
        await service.findInvitableRoleIds(CHAPTER_ID, USER.president),
      ).toHaveLength(tieredChapterRoles().length - 1);
    });
  });

  describe('default invite role (#422)', () => {
    function role(over: Partial<Role> = {}): Role {
      return roleFixture({
        id: 'role-member',
        name: 'Member',
        system_key: SystemRoleKeys.EVERYONE,
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

    it('reads the founding wizard\'s "Everyone" as the Everyone role, whatever it is called (#1830)', async () => {
      // The chapter's Everyone role still carries its old name.
      await expect(
        service.create('ch-1', 'user-1', 'Everyone'),
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
