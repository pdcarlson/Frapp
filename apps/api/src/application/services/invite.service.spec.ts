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
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { InviteService } from './invite.service';
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
import { ActivationService } from './activation.service';
import { ChatService } from './chat.service';
import { ConfigService } from '@nestjs/config';
import { EMAIL_PROVIDER } from '#domain/adapters/email.interface';
import type { IEmailProvider } from '#domain/adapters/email.interface';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

describe('InviteService', () => {
  let service: InviteService;
  let mockInviteRepo: jest.Mocked<IInviteRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;
  let mockRoleRepo: jest.Mocked<IRoleRepository>;
  let mockNotificationService: jest.Mocked<
    Pick<NotificationService, 'notifyUser' | 'notifyChapter'>
  >;
  let mockActivation: jest.Mocked<Pick<ActivationService, 'record'>>;
  let mockEmailProvider: jest.Mocked<IEmailProvider>;
  let mockConfig: jest.Mocked<Pick<ConfigService, 'get'>>;
  let mockUserRepo: jest.Mocked<IUserRepository>;
  let mockChatService: jest.Mocked<Pick<ChatService, 'getOrCreateDm'>>;
  let mockSupabase: { from: jest.Mock };
  let mockChapterRepo: jest.Mocked<IChapterRepository>;
  let messageInsert: jest.Mock;
  /** Backs `chapters.default_invite_role_id` for the mock above (#422). */
  let chapterDefaultRoleId: string | null;

  beforeEach(async () => {
    mockInviteRepo = {
      findById: jest.fn(),
      findByToken: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      markUsed: jest.fn(),
      markUsedAtomically: jest.fn(),
    };

    mockMemberRepo = {
      findById: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockRoleRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      findByIds: jest.fn(),
      findByChapterAndName: jest.fn(),
      findByChapterAndSystemKey: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockNotificationService = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      notifyChapter: jest.fn().mockResolvedValue(undefined),
    };

    mockActivation = { record: jest.fn().mockResolvedValue(true) };

    mockEmailProvider = { sendInviteEmail: jest.fn().mockResolvedValue(true) };
    mockConfig = { get: jest.fn().mockReturnValue(undefined) };

    mockUserRepo = {
      findById: jest.fn(),
      findByIds: jest.fn(),
      findDisplayIdentitiesByIds: jest.fn(),
      findBySupabaseAuthId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      anonymize: jest.fn(),
    };
    mockChatService = {
      getOrCreateDm: jest
        .fn()
        .mockResolvedValue({ id: 'dm-1', type: 'DM', member_ids: [] }),
    };
    messageInsert = jest.fn().mockResolvedValue({ error: null });
    // #422: `resolveInviteRole` reads `chapters.default_invite_role_id`
    // through the chapter repository whenever the caller does not name a
    // role. Defaults to "no default configured", which is the pre-#422 world
    // every other test in this file assumes.
    chapterDefaultRoleId = null;
    mockChapterRepo = {
      findById: jest.fn(),
      findBySubscriptionId: jest.fn(),
      findByCustomerId: jest.fn(),
      claimSubscriptionId: jest.fn(),
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

    mockSupabase = {
      from: jest.fn((table: string) => {
        if (table === 'chat_messages') return { insert: messageInsert };
        return {};
      }),
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
        { provide: SUPABASE_CLIENT, useValue: mockSupabase },
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
    const expiresAt = new Date(createCall.expires_at);
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
          })),
        ),
      );
    });

    it('creates one invite per unique email and sends each a join link', async () => {
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
      expect(mockEmailProvider.sendInviteEmail).toHaveBeenCalledWith({
        to: 'a@example.com',
        joinUrl: `https://app.frapp.live/join?token=${inviteData[0].token}`,
        role: 'Member',
      });
      expect(mockEmailProvider.sendInviteEmail).toHaveBeenCalledWith({
        to: 'b@example.com',
        joinUrl: `https://app.frapp.live/join?token=${inviteData[1].token}`,
        role: 'Member',
      });
      expect(result.invites).toHaveLength(2);
      expect(result.failed).toEqual([]);
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
    };
    const memberRole: Role = {
      id: 'role-member',
      chapter_id: 'ch-1',
      name: 'Member',
      system_key: SystemRoleKeys.MEMBER,
      permissions: [],
      is_system: true,
      display_order: 3,
      color: null,
      created_at: '2024-01-01',
    };
    const member: Member = {
      id: 'member-1',
      user_id: 'user-2',
      chapter_id: 'ch-1',
      role_ids: [memberRole.id],
      custom_role_ids: [],
      has_completed_onboarding: false,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
    mockInviteRepo.markUsedAtomically.mockResolvedValue(true);
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
      mockInviteRepo.markUsedAtomically.mockResolvedValue(true);
      mockRoleRepo.findByChapter.mockResolvedValue([]);
      mockMemberRepo.create.mockResolvedValue({
        id: 'member-x',
        user_id: 'user-2',
        chapter_id: 'ch-1',
        role_ids: [],
        custom_role_ids: [],
        has_completed_onboarding: false,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
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
      mockMemberRepo.findByUserAndChapter.mockResolvedValue({
        id: 'member-existing',
        user_id: 'user-2',
        chapter_id: 'ch-1',
        role_ids: [],
        custom_role_ids: [],
        has_completed_onboarding: true,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      });

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
    };
    const memberRole: Role = {
      id: 'role-member',
      chapter_id: 'ch-1',
      name: 'Member',
      system_key: SystemRoleKeys.MEMBER,
      permissions: [],
      is_system: true,
      display_order: 3,
      color: null,
      created_at: '2024-01-01',
    };
    const member: Member = {
      id: 'member-1',
      user_id: 'user-2',
      chapter_id: 'ch-1',
      role_ids: [memberRole.id],
      custom_role_ids: [],
      has_completed_onboarding: false,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };

    beforeEach(() => {
      mockInviteRepo.findByToken.mockResolvedValue(invite);
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
      mockInviteRepo.markUsedAtomically.mockResolvedValue(true);
      mockRoleRepo.findByChapter.mockResolvedValue([memberRole]);
      mockMemberRepo.create.mockResolvedValue(member);
    });

    it('DMs the inviter with a system_audit message naming the accepter', async () => {
      mockUserRepo.findById.mockResolvedValue({
        id: 'user-2',
        supabase_auth_id: 'auth-2',
        email: 'alex@example.com',
        display_name: 'Alex Chen',
        avatar_url: null,
        bio: null,
        graduation_year: null,
        current_city: null,
        current_company: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      });

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
      mockUserRepo.findById.mockResolvedValue({
        id: 'user-2',
        supabase_auth_id: 'auth-2',
        email: 'alex@example.com',
        display_name: 'Alex Chen',
        avatar_url: null,
        bio: null,
        graduation_year: null,
        current_city: null,
        current_company: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      });
      // A departed inviter, a chat outage, or any other DM-path failure —
      // this covers the "missing inviter" edge case the fix must survive.
      mockChatService.getOrCreateDm.mockRejectedValue(new Error('boom'));

      const result = await service.redeem('test-uuid', 'user-2');

      expect(result).toEqual({ chapterId: 'ch-1', memberId: 'member-1' });
    });

    it('skips the DM entirely when the accepter is the invite creator (rejoin)', async () => {
      mockInviteRepo.findByToken.mockResolvedValue({
        ...invite,
        created_by: 'user-2',
      });
      mockUserRepo.findById.mockResolvedValue({
        id: 'user-2',
        supabase_auth_id: 'auth-2',
        email: 'alex@example.com',
        display_name: 'Alex Chen',
        avatar_url: null,
        bio: null,
        graduation_year: null,
        current_city: null,
        current_company: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      });

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
    };
    const memberRole: Role = {
      id: 'role-member',
      chapter_id: 'ch-1',
      name: 'Member',
      system_key: SystemRoleKeys.MEMBER,
      permissions: [],
      is_system: true,
      display_order: 3,
      color: null,
      created_at: '2024-01-01',
    };
    const member: Member = {
      id: 'member-1',
      user_id: 'user-2',
      chapter_id: 'ch-1',
      role_ids: [memberRole.id],
      custom_role_ids: [],
      has_completed_onboarding: false,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
    mockInviteRepo.markUsedAtomically.mockResolvedValue(true);
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
    };
    const renamedMemberRole: Role = {
      id: 'role-member',
      chapter_id: 'ch-1',
      name: 'Active Brother',
      system_key: SystemRoleKeys.MEMBER,
      permissions: [],
      is_system: true,
      display_order: 3,
      color: null,
      created_at: '2024-01-01',
    };
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
    mockInviteRepo.markUsedAtomically.mockResolvedValue(true);
    mockRoleRepo.findByChapter.mockResolvedValue([renamedMemberRole]);
    mockMemberRepo.create.mockResolvedValue({
      id: 'member-1',
      user_id: 'user-2',
      chapter_id: 'ch-1',
      role_ids: [renamedMemberRole.id],
      custom_role_ids: [],
      has_completed_onboarding: false,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    });

    await service.redeem('test-uuid', 'user-2');

    expect(mockMemberRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ role_ids: ['role-member'] }),
    );
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
    };
    const existingMember: Member = {
      id: 'member-1',
      user_id: 'user-2',
      chapter_id: 'ch-1',
      role_ids: ['role-1'],
      custom_role_ids: [],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
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
      },
    ];
    mockInviteRepo.findByChapter.mockResolvedValue(invites);

    const result = await service.findByChapter('ch-1');

    expect(mockInviteRepo.findByChapter).toHaveBeenCalledWith('ch-1');
    expect(result).toEqual(invites);
  });

  it('should notify chapter when invite is redeemed', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
    };
    const memberRole: Role = {
      id: 'role-member',
      chapter_id: 'ch-1',
      name: 'Member',
      system_key: SystemRoleKeys.MEMBER,
      permissions: [],
      is_system: true,
      display_order: 3,
      color: null,
      created_at: '2024-01-01',
    };
    const member: Member = {
      id: 'member-1',
      user_id: 'user-2',
      chapter_id: 'ch-1',
      role_ids: [memberRole.id],
      custom_role_ids: [],
      has_completed_onboarding: false,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
    mockInviteRepo.markUsedAtomically.mockResolvedValue(true);
    mockRoleRepo.findByChapter.mockResolvedValue([memberRole]);
    mockMemberRepo.create.mockResolvedValue(member);

    await service.redeem('test-uuid', 'user-2');

    expect(mockNotificationService.notifyChapter).toHaveBeenCalledWith(
      'ch-1',
      expect.objectContaining({
        title: 'New Member Joined',
        priority: 'NORMAL',
        category: 'admin',
      }),
    );
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
    };
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
    mockInviteRepo.markUsedAtomically.mockResolvedValue(false);

    const promise = service.redeem('test-uuid', 'user-2');
    await expect(promise).rejects.toThrow(GoneException);
    await expect(promise).rejects.toThrow('Invite already used');
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
    };
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
    mockInviteRepo.markUsedAtomically.mockResolvedValue(true);
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
    };
    const existingMember: Member = {
      id: 'member-1',
      user_id: 'user-2',
      chapter_id: 'ch-1',
      role_ids: ['role-1'],
      custom_role_ids: [],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
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
      };
      mockInviteRepo.findById.mockResolvedValue(invite);
      mockInviteRepo.markUsed.mockResolvedValue(undefined);

      await service.revoke('inv-1', 'ch-1');

      expect(mockInviteRepo.findById).toHaveBeenCalledWith('inv-1');
      expect(mockInviteRepo.markUsed).toHaveBeenCalledWith('inv-1');
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
      };
      mockInviteRepo.findById.mockResolvedValue(invite);

      await expect(service.revoke('inv-1', 'ch-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.revoke('inv-1', 'ch-1')).rejects.toThrow(
        'Invite has already been used',
      );
      expect(mockInviteRepo.markUsed).not.toHaveBeenCalled();
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
  describe('default invite role (#422)', () => {
    function role(over: Partial<Role> = {}): Role {
      return {
        id: 'role-member',
        chapter_id: 'ch-1',
        name: 'Member',
        system_key: SystemRoleKeys.MEMBER,
        permissions: [],
        is_system: true,
        display_order: 3,
        color: null,
        created_at: '2024-01-01',
        ...over,
      };
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
      chapterDefaultRoleId = 'role-pledge';

      const invite = await service.create('ch-1', 'user-1', 'Member');

      expect(invite.role).toBe('Member');
      // The explicit path short-circuits before any lookup, so naming a role
      // costs neither the roles read nor the chapters read.
      expect(mockRoleRepo.findByChapter).not.toHaveBeenCalled();
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
