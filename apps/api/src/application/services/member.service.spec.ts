import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { MemberService } from './member.service';
import { ProfilePhotoUrlService } from './profile-photo-url.service';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { CHAT_CHANNEL_REPOSITORY } from '#domain/repositories/chat.repository.interface';
import { ChannelCacheService } from './channel-cache.service';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import type { IRoleRepository } from '#domain/repositories/role.repository.interface';
import { SystemRoleKeys } from '#domain/constants/permissions';
import { CustomFieldService } from './custom-field.service';
import { RbacService } from './rbac.service';
import {
  CHAPTER_ID,
  MEMBER as TIERED_MEMBER,
  ROLE,
  USER,
  tieredChapterMembers,
  tieredChapterRoles,
  tieredRankContext,
} from '#test/helpers/tiered-chapter.fixture';
import { ChapterAuditLogService } from './chapter-audit-log.service';
import {
  createAuditLogServiceMock,
  type AuditLogServiceMock,
} from '#test/helpers/audit-log.mock';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import type { Member } from '#domain/entities/member.entity';
import type { User } from '#domain/entities/user.entity';
import {
  memberFixture,
  roleFixture,
  userFixture,
} from '#test/helpers/entity-fixtures';

describe('MemberService', () => {
  let service: MemberService;
  let mockRepo: jest.Mocked<IMemberRepository>;
  let mockUserRepo: jest.Mocked<IUserRepository>;
  let mockRoleRepo: jest.Mocked<IRoleRepository>;
  let mockCustomFieldService: {
    findVisibleValuesForMember: jest.Mock;
    findFieldIdsByVisibility: jest.Mock;
    findValuesByFieldIds: jest.Mock;
  };
  let mockRbacService: {
    getEffectivePermissions: jest.Mock;
    flagIfPresidentRemoved: jest.Mock;
    getAlumniRoleId: jest.Mock;
    getRankContext: jest.Mock;
  };
  let mockAuditLogService: AuditLogServiceMock;
  let mockStorageProvider: {
    listFiles: jest.Mock;
    deleteFiles: jest.Mock;
    getSignedDownloadUrls: jest.Mock;
  };
  let mockChannelRepo: { removeUserFromPrivateChannels: jest.Mock };
  let mockChannelCache: { invalidate: jest.Mock };

  beforeEach(async () => {
    mockRepo = {
      findById: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      // One chapter each unless a test says otherwise (#4367).
      findByUser: jest.fn().mockResolvedValue([]),
      findChapterMemberIdentities: jest.fn(),
      transferPresidencyAtomic: jest.fn(),
      claimPresidencyAtomic: jest.fn(),
    };

    mockUserRepo = {
      findById: jest.fn(),
      findByIds: jest.fn(),
      findDisplayIdentitiesByIds: jest.fn(),
      findContactsByIds: jest.fn(),
      findBySupabaseAuthId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      anonymize: jest.fn(),
      compareAndSetWhatsNewSeen: jest.fn(),
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
      createMany: jest.fn(),
    };

    mockCustomFieldService = {
      findVisibleValuesForMember: jest.fn().mockResolvedValue([]),
      findFieldIdsByVisibility: jest.fn().mockResolvedValue([]),
      findValuesByFieldIds: jest.fn().mockResolvedValue([]),
    };
    mockRbacService = {
      getEffectivePermissions: jest.fn().mockResolvedValue([]),
      // The caller holds `*` unless a test says otherwise (#4071).
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
      flagIfPresidentRemoved: jest.fn().mockResolvedValue(undefined),
      // The real lookup, over the mocked role repository, so each test states
      // the chapter's Alumni role once, on `findByChapterAndSystemKey`.
      getAlumniRoleId: jest.fn(async (chapterId: string) => {
        const role = await mockRoleRepo.findByChapterAndSystemKey(
          chapterId,
          SystemRoleKeys.ALUMNI,
        );
        return role?.id ?? null;
      }),
    };
    mockAuditLogService = createAuditLogServiceMock();
    mockStorageProvider = {
      listFiles: jest.fn().mockResolvedValue([]),
      deleteFiles: jest.fn().mockResolvedValue(undefined),
      getSignedDownloadUrls: jest.fn(async (_bucket: string, paths: string[]) =>
        Object.fromEntries(paths.map((path) => [path, `signed:${path}`])),
      ),
    };
    mockChannelRepo = {
      removeUserFromPrivateChannels: jest.fn().mockResolvedValue([]),
    };
    mockChannelCache = { invalidate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberService,
        // Real, over the storage mock, so the read tests pin what a client
        // actually receives in `avatar_url`.
        ProfilePhotoUrlService,
        { provide: MEMBER_REPOSITORY, useValue: mockRepo },
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
        { provide: ROLE_REPOSITORY, useValue: mockRoleRepo },
        { provide: CustomFieldService, useValue: mockCustomFieldService },
        { provide: RbacService, useValue: mockRbacService },
        { provide: ChapterAuditLogService, useValue: mockAuditLogService },
        { provide: STORAGE_PROVIDER, useValue: mockStorageProvider },
        { provide: CHAT_CHANNEL_REPOSITORY, useValue: mockChannelRepo },
        { provide: ChannelCacheService, useValue: mockChannelCache },
      ],
    }).compile();

    service = module.get(MemberService);
  });

  it('should list member profiles by chapter', async () => {
    const members = [
      memberFixture({
        chapter_id: 'chapter-1',
        role_ids: ['role-1'],
        has_completed_onboarding: true,
      }),
    ];
    const users = [
      userFixture({
        email: 'john@example.com',
        display_name: 'John Doe',
      }),
    ];
    mockRepo.findByChapter.mockResolvedValue(members);
    mockUserRepo.findByIds.mockResolvedValue(users);

    const result = await service.findByChapter('chapter-1');

    expect(mockRepo.findByChapter).toHaveBeenCalledWith('chapter-1');
    expect(mockUserRepo.findByIds).toHaveBeenCalledWith(['user-1']);
    expect(result).toEqual([
      expect.objectContaining({
        id: 'member-1',
        user_id: 'user-1',
        chapter_id: 'chapter-1',
        display_name: 'John Doe',
        email: 'john@example.com',
      }),
    ]);
  });

  it('should find member by user and chapter', async () => {
    const member = memberFixture({
      chapter_id: 'chapter-1',
      role_ids: ['role-1'],
      has_completed_onboarding: true,
    });
    mockRepo.findByUserAndChapter.mockResolvedValue(member);

    const result = await service.findByUserAndChapter('user-1', 'chapter-1');

    expect(mockRepo.findByUserAndChapter).toHaveBeenCalledWith(
      'user-1',
      'chapter-1',
    );
    expect(result).toEqual(member);
  });

  it('should throw NotFoundException when member not found', async () => {
    mockRepo.findByUserAndChapter.mockResolvedValue(null);

    await expect(
      service.findByUserAndChapter('user-1', 'chapter-1'),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.findByUserAndChapter('user-1', 'chapter-1'),
    ).rejects.toThrow('Member not found');
  });

  // The roster projection exists so a display surface never has to pull
  // MemberProfile. Its whole point is what it leaves out, so these assert the
  // narrow lookup is the one used and the shape stays three fields wide.
  describe('findRosterByChapter', () => {
    const memberRow = (userId: string, id = `member-${userId}`) =>
      memberFixture({
        id,
        user_id: userId,
        chapter_id: 'chapter-1',
        role_ids: ['role-1'],
        has_completed_onboarding: true,
      });

    beforeEach(() => {
      mockRoleRepo.findByChapter.mockResolvedValue([]);
    });

    it('returns one display-only entry per member', async () => {
      mockRepo.findByChapter.mockResolvedValue([
        memberRow('user-1'),
        memberRow('user-2'),
      ]);
      mockUserRepo.findDisplayIdentitiesByIds.mockResolvedValue([
        { id: 'user-1', display_name: 'Marcus Reid', avatar_url: null },
        {
          id: 'user-2',
          display_name: 'Dana Lowe',
          avatar_url: 'chapters/chapter-1/profiles/user-2/a.png',
        },
      ]);

      const result = await service.findRosterByChapter('chapter-1');

      expect(result).toEqual([
        {
          user_id: 'user-1',
          display_name: 'Marcus Reid',
          avatar_url: null,
          role_color: null,
        },
        {
          user_id: 'user-2',
          display_name: 'Dana Lowe',
          avatar_url: 'signed:chapters/chapter-1/profiles/user-2/a.png',
          role_color: null,
        },
      ]);
    });

    it("signs each member's own uploaded photo and drops a path into someone else's folder (#732)", async () => {
      const own = 'chapters/chapter-1/profiles/user-1/p.jpg';
      mockRepo.findByChapter.mockResolvedValue([
        memberRow('user-1'),
        memberRow('user-2'),
      ]);
      mockUserRepo.findDisplayIdentitiesByIds.mockResolvedValue([
        { id: 'user-1', display_name: 'Marcus Reid', avatar_url: own },
        { id: 'user-2', display_name: 'Dana Lowe', avatar_url: own },
      ]);

      const result = await service.findRosterByChapter('chapter-1');

      expect(result.map((entry) => entry.avatar_url)).toEqual([
        `signed:${own}`,
        null,
      ]);
      expect(mockStorageProvider.getSignedDownloadUrls).toHaveBeenCalledTimes(
        1,
      );
    });

    it('reads through the narrow projection, never the full user row', async () => {
      mockRepo.findByChapter.mockResolvedValue([memberRow('user-1')]);
      mockUserRepo.findDisplayIdentitiesByIds.mockResolvedValue([
        { id: 'user-1', display_name: 'Marcus Reid', avatar_url: null },
      ]);

      await service.findRosterByChapter('chapter-1');

      expect(mockUserRepo.findDisplayIdentitiesByIds).toHaveBeenCalledWith([
        'user-1',
      ]);
      // Guards the reason this method exists: `findByIds` selects '*'.
      expect(mockUserRepo.findByIds).not.toHaveBeenCalled();
    });

    it('de-duplicates user ids before the lookup', async () => {
      mockRepo.findByChapter.mockResolvedValue([
        memberRow('user-1', 'member-a'),
        memberRow('user-1', 'member-b'),
      ]);
      mockUserRepo.findDisplayIdentitiesByIds.mockResolvedValue([
        { id: 'user-1', display_name: 'Marcus Reid', avatar_url: null },
      ]);

      const result = await service.findRosterByChapter('chapter-1');

      expect(mockUserRepo.findDisplayIdentitiesByIds).toHaveBeenCalledWith([
        'user-1',
      ]);
      expect(result).toHaveLength(1);
    });

    it('skips a member whose user row is missing instead of throwing', async () => {
      // findByChapter throws NotFoundException here; the roster must not, or one
      // orphaned membership row takes the whole chat surface down.
      mockRepo.findByChapter.mockResolvedValue([
        memberRow('user-1'),
        memberRow('user-ghost'),
      ]);
      mockUserRepo.findDisplayIdentitiesByIds.mockResolvedValue([
        { id: 'user-1', display_name: 'Marcus Reid', avatar_url: null },
      ]);

      const result = await service.findRosterByChapter('chapter-1');

      expect(result).toEqual([
        {
          user_id: 'user-1',
          display_name: 'Marcus Reid',
          avatar_url: null,
          role_color: null,
        },
      ]);
    });

    it('returns an empty roster without a user lookup for an empty chapter', async () => {
      mockRepo.findByChapter.mockResolvedValue([]);

      const result = await service.findRosterByChapter('chapter-1');

      expect(result).toEqual([]);
      expect(mockUserRepo.findDisplayIdentitiesByIds).not.toHaveBeenCalled();
    });

    it('passes an empty display_name through for the client to treat as unresolved', async () => {
      // users.display_name is NOT NULL DEFAULT '', so '' is the real
      // "no name set" case. The server does not invent a placeholder.
      mockRepo.findByChapter.mockResolvedValue([memberRow('user-1')]);
      mockUserRepo.findDisplayIdentitiesByIds.mockResolvedValue([
        { id: 'user-1', display_name: '', avatar_url: null },
      ]);

      const result = await service.findRosterByChapter('chapter-1');

      expect(result).toEqual([
        {
          user_id: 'user-1',
          display_name: '',
          avatar_url: null,
          role_color: null,
        },
      ]);
    });
    it('paints every name plain instead of failing when the roles read fails (#3485)', async () => {
      mockRepo.findByChapter.mockResolvedValue([memberRow('user-1')]);
      mockUserRepo.findDisplayIdentitiesByIds.mockResolvedValue([
        { id: 'user-1', display_name: 'Marcus Reid', avatar_url: null },
      ]);
      mockRoleRepo.findByChapter.mockRejectedValue(new Error('timeout'));

      const result = await service.findRosterByChapter('chapter-1');

      expect(result).toEqual([
        {
          user_id: 'user-1',
          display_name: 'Marcus Reid',
          avatar_url: null,
          role_color: null,
        },
      ]);
    });

    it("colors each entry with the member's highest-ranked palette role (#3485)", async () => {
      mockRepo.findByChapter.mockResolvedValue([
        memberFixture({
          id: 'member-1',
          user_id: 'user-1',
          chapter_id: 'chapter-1',
          role_ids: ['role-member', 'role-treasurer'],
        }),
        memberFixture({
          id: 'member-2',
          user_id: 'user-2',
          chapter_id: 'chapter-1',
          role_ids: ['role-member', 'role-legacy'],
        }),
      ]);
      mockUserRepo.findDisplayIdentitiesByIds.mockResolvedValue([
        { id: 'user-1', display_name: 'Marcus Reid', avatar_url: null },
        { id: 'user-2', display_name: 'Dana Lowe', avatar_url: null },
      ]);
      mockRoleRepo.findByChapter.mockResolvedValue([
        roleFixture({
          id: 'role-treasurer',
          color: '#6FD08C',
          display_order: 2,
        }),
        roleFixture({ id: 'role-member', color: null, display_order: 5 }),
        // An off-palette value (the old President seed) paints nothing.
        roleFixture({ id: 'role-legacy', color: '#FFD700', display_order: 1 }),
      ]);

      const result = await service.findRosterByChapter('chapter-1');

      expect(mockRoleRepo.findByChapter).toHaveBeenCalledWith('chapter-1');
      expect(result.map((entry) => entry.role_color)).toEqual([
        '#6FD08C',
        null,
      ]);
    });
  });

  describe('findRosterWithJoinDates', () => {
    const memberRow = (
      userId: string,
      createdAt: string,
      id = `member-${userId}`,
    ) =>
      memberFixture({
        id,
        user_id: userId,
        chapter_id: 'chapter-1',
        role_ids: ['role-1'],
        has_completed_onboarding: true,
        created_at: createdAt,
        updated_at: createdAt,
      });

    it('carries each membership join timestamp alongside the roster projection', async () => {
      mockRepo.findByChapter.mockResolvedValue([
        memberRow('user-1', '2026-01-15T00:00:00.000Z'),
      ]);
      mockUserRepo.findDisplayIdentitiesByIds.mockResolvedValue([
        { id: 'user-1', display_name: 'Marcus Reid', avatar_url: null },
      ]);

      const result = await service.findRosterWithJoinDates('chapter-1');

      expect(result).toEqual([
        {
          user_id: 'user-1',
          display_name: 'Marcus Reid',
          avatar_url: null,
          joined_at: '2026-01-15T00:00:00.000Z',
        },
      ]);
    });

    it('does one membership read and one identity batch for the whole chapter', async () => {
      mockRepo.findByChapter.mockResolvedValue([
        memberRow('user-1', '2026-01-15T00:00:00.000Z'),
        memberRow('user-2', '2026-02-01T00:00:00.000Z'),
      ]);
      mockUserRepo.findDisplayIdentitiesByIds.mockResolvedValue([
        { id: 'user-1', display_name: 'Marcus Reid', avatar_url: null },
        { id: 'user-2', display_name: 'Dana Lowe', avatar_url: null },
      ]);

      await service.findRosterWithJoinDates('chapter-1');

      expect(mockRepo.findByChapter).toHaveBeenCalledTimes(1);
      expect(mockUserRepo.findDisplayIdentitiesByIds).toHaveBeenCalledTimes(1);
    });

    it('skips a member whose user row is missing instead of throwing', async () => {
      mockRepo.findByChapter.mockResolvedValue([
        memberRow('user-1', '2026-01-15T00:00:00.000Z'),
        memberRow('user-ghost', '2026-01-16T00:00:00.000Z'),
      ]);
      mockUserRepo.findDisplayIdentitiesByIds.mockResolvedValue([
        { id: 'user-1', display_name: 'Marcus Reid', avatar_url: null },
      ]);

      const result = await service.findRosterWithJoinDates('chapter-1');

      expect(result).toHaveLength(1);
    });

    it('returns an empty roster without a user lookup for an empty chapter', async () => {
      mockRepo.findByChapter.mockResolvedValue([]);

      const result = await service.findRosterWithJoinDates('chapter-1');

      expect(result).toEqual([]);
      expect(mockUserRepo.findDisplayIdentitiesByIds).not.toHaveBeenCalled();
    });
  });

  describe('updateRoles', () => {
    const existingMember = memberFixture({
      chapter_id: 'chapter-1',
      role_ids: ['role-1'],
      has_completed_onboarding: true,
    });
    const presidentRole = roleFixture({
      id: 'role-president',
      chapter_id: 'chapter-1',
      name: 'President',
      permissions: ['*'],
      is_system: true,
      display_order: 1,
      color: '#FFD700',
    });
    const memberRole = roleFixture({
      chapter_id: 'chapter-1',
      name: 'Member',
      permissions: ['members:view'],
      is_system: true,
      display_order: 5,
    });
    const customRole = roleFixture({
      id: 'role-2',
      chapter_id: 'chapter-1',
      name: 'Social Chair',
      permissions: ['events:create'],
      display_order: 8,
    });

    it('updates non-President roles for an ordinary member', async () => {
      mockRepo.findById.mockResolvedValue(existingMember);
      mockRoleRepo.findByChapter.mockResolvedValue([
        presidentRole,
        memberRole,
        customRole,
      ]);
      const updated = { ...existingMember, role_ids: ['role-1', 'role-2'] };
      mockRepo.update.mockResolvedValue(updated);

      const result = await service.updateRoles(
        'member-1',
        ['role-1', 'role-2'],
        'chapter-1',
        'user-actor',
      );

      expect(mockRepo.update).toHaveBeenCalledWith('member-1', {
        role_ids: ['role-1', 'role-2'],
      });
      expect(result).toEqual(updated);
    });

    it('throws when member is not found', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateRoles('member-x', ['role-1'], 'chapter-1', 'user-actor'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when member belongs to a different chapter', async () => {
      mockRepo.findById.mockResolvedValue({
        ...existingMember,
        chapter_id: 'chapter-other',
      });

      await expect(
        service.updateRoles('member-1', ['role-1'], 'chapter-1', 'user-actor'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects role IDs that do not belong to the chapter', async () => {
      mockRepo.findById.mockResolvedValue(existingMember);
      mockRoleRepo.findByChapter.mockResolvedValue([presidentRole, memberRole]);

      await expect(
        service.updateRoles(
          'member-1',
          ['role-1', 'role-from-other-chapter'],
          'chapter-1',
          'user-actor',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('blocks adding the President role through the generic endpoint', async () => {
      mockRepo.findById.mockResolvedValue(existingMember);
      mockRoleRepo.findByChapter.mockResolvedValue([presidentRole, memberRole]);

      await expect(
        service.updateRoles(
          'member-1',
          ['role-1', 'role-president'],
          'chapter-1',
          'user-actor',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('blocks removing the President role through the generic endpoint', async () => {
      mockRepo.findById.mockResolvedValue({
        ...existingMember,
        role_ids: ['role-president', 'role-1'],
      });
      mockRoleRepo.findByChapter.mockResolvedValue([presidentRole, memberRole]);

      await expect(
        service.updateRoles('member-1', ['role-1'], 'chapter-1', 'user-actor'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('allows keeping the President role unchanged while editing other roles', async () => {
      mockRepo.findById.mockResolvedValue({
        ...existingMember,
        role_ids: ['role-president', 'role-1'],
      });
      mockRoleRepo.findByChapter.mockResolvedValue([
        presidentRole,
        memberRole,
        customRole,
      ]);
      const updated = {
        ...existingMember,
        role_ids: ['role-president', 'role-2'],
      };
      mockRepo.update.mockResolvedValue(updated);

      const result = await service.updateRoles(
        'member-1',
        ['role-president', 'role-2'],
        'chapter-1',
        'user-actor',
      );

      expect(mockRepo.update).toHaveBeenCalledWith('member-1', {
        role_ids: ['role-president', 'role-2'],
      });
      expect(result).toEqual(updated);
    });

    it('tolerates a stale live-role id the member already holds', async () => {
      // Deleting a live role leaves its id on member rows (spec Edge Cases);
      // echoing it back must not fail the save.
      mockRepo.findById.mockResolvedValue({
        ...existingMember,
        role_ids: ['role-1', 'role-deleted'],
      });
      mockRoleRepo.findByChapter.mockResolvedValue([presidentRole, memberRole]);
      const updated = {
        ...existingMember,
        role_ids: ['role-1', 'role-deleted'],
      };
      mockRepo.update.mockResolvedValue(updated);

      await service.updateRoles(
        'member-1',
        ['role-1', 'role-deleted'],
        'chapter-1',
        'user-actor',
      );

      expect(mockRepo.update).toHaveBeenCalledWith('member-1', {
        role_ids: ['role-1', 'role-deleted'],
      });
    });

    it('compares wildcard roles as sets: duplicates neither bypass nor false-403', async () => {
      // (a) A duplicated held president id must not mask adding a second
      // wildcard role, and (b) a duplicate in a no-op payload must not read
      // as a presidency change.
      const legacyWildcardRole = roleFixture({
        id: 'role-legacy-star',
        chapter_id: 'chapter-1',
        name: 'Legacy Star',
        permissions: ['*'],
        display_order: 9,
      });
      mockRoleRepo.findByChapter.mockResolvedValue([
        presidentRole,
        memberRole,
        legacyWildcardRole,
      ]);

      // (a) held [legacy, legacy]; payload [legacy, president] — lengths
      // match, but the SET gains the president role → must be blocked.
      mockRepo.findById.mockResolvedValue({
        ...existingMember,
        role_ids: ['role-legacy-star', 'role-legacy-star'],
      });
      await expect(
        service.updateRoles(
          'member-1',
          ['role-legacy-star', 'role-president'],
          'chapter-1',
          'user-actor',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRepo.update).not.toHaveBeenCalled();

      // (b) held [president]; payload [president, president, member role] —
      // the wildcard SET is unchanged → allowed.
      mockRepo.findById.mockResolvedValue({
        ...existingMember,
        role_ids: ['role-president'],
      });
      const updated = {
        ...existingMember,
        role_ids: ['role-president', 'role-president', 'role-1'],
      };
      mockRepo.update.mockResolvedValue(updated);

      await service.updateRoles(
        'member-1',
        ['role-president', 'role-president', 'role-1'],
        'chapter-1',
        'user-actor',
      );
      expect(mockRepo.update).toHaveBeenCalledWith('member-1', {
        role_ids: ['role-president', 'role-president', 'role-1'],
      });
    });

    it('blocks assigning a non-system role that carries the wildcard', async () => {
      // A legacy `*` role minted before wildcard writes were rejected must not
      // be attachable through the generic endpoint — the presidency-transfer
      // flow is the only path that moves wildcard access.
      const legacyWildcardRole = roleFixture({
        id: 'role-legacy-star',
        chapter_id: 'chapter-1',
        name: 'Legacy Star',
        permissions: ['*'],
        display_order: 9,
      });
      mockRepo.findById.mockResolvedValue(existingMember);
      mockRoleRepo.findByChapter.mockResolvedValue([
        presidentRole,
        memberRole,
        legacyWildcardRole,
      ]);

      await expect(
        service.updateRoles(
          'member-1',
          ['role-1', 'role-legacy-star'],
          'chapter-1',
          'user-actor',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('writes role_ids and never custom_role_ids (#4075)', async () => {
      mockRepo.findById.mockResolvedValue(existingMember);
      mockRoleRepo.findByChapter.mockResolvedValue([presidentRole, memberRole]);
      const updated = { ...existingMember };
      mockRepo.update.mockResolvedValue(updated);

      await service.updateRoles(
        'member-1',
        ['role-1'],
        'chapter-1',
        'user-actor',
      );

      expect(mockRepo.update).toHaveBeenCalledWith('member-1', {
        role_ids: ['role-1'],
      });
    });
  });

  it('should update onboarding status', async () => {
    const updatedMember = memberFixture({
      chapter_id: 'chapter-1',
      role_ids: ['role-1'],
      has_completed_onboarding: true,
      updated_at: '2024-01-02',
    });
    mockRepo.update.mockResolvedValue(updatedMember);

    const result = await service.updateOnboarding('member-1', true);

    expect(mockRepo.update).toHaveBeenCalledWith('member-1', {
      has_completed_onboarding: true,
    });
    expect(result).toEqual(updatedMember);
  });

  // #4071: the rank rules on giving and taking roles, over a chapter with a
  // President, exec officers, chairs and brothers.
  describe('updateRoles rank rules', () => {
    const roles = tieredChapterRoles();
    const members = tieredChapterMembers();
    const memberRow = (id: string) => members.find((m) => m.id === id)!;
    const save = (memberId: string, roleIds: string[], actorUserId: string) => {
      mockRepo.findById.mockResolvedValue(memberRow(memberId));
      mockRoleRepo.findByChapter.mockResolvedValue(roles);
      mockRepo.update.mockImplementation(async (id, data) => ({
        ...memberRow(id),
        ...data,
      }));
      mockRbacService.getRankContext.mockResolvedValue(
        tieredRankContext(actorUserId),
      );
      return service.updateRoles(memberId, roleIds, CHAPTER_ID, actorUserId);
    };

    it("stops a chair giving themselves an officer's role", async () => {
      await expect(
        save(
          TIERED_MEMBER.riskChair,
          [ROLE.riskChair, ROLE.brother, ROLE.vicePresident],
          USER.riskChair,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it("stops a chair giving anyone a role in the chairs' own tier", async () => {
      await expect(
        save(
          TIERED_MEMBER.brother,
          [ROLE.brother, ROLE.socialChair],
          USER.riskChair,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('stops a chair handing themselves a lower role that carries more than they hold', async () => {
      await expect(
        save(
          TIERED_MEMBER.riskChair,
          [ROLE.riskChair, ROLE.brother, ROLE.treasuryAssistant],
          USER.riskChair,
        ),
      ).rejects.toThrow(/billing:view/);
    });

    it('stops a chair taking a role away from an officer who outranks them', async () => {
      await expect(
        save(TIERED_MEMBER.vicePresident, [ROLE.vicePresident], USER.riskChair),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a chair give a brother a role below the chairs', async () => {
      await save(
        TIERED_MEMBER.brother,
        [ROLE.brother, ROLE.pledge],
        USER.riskChair,
      );
      expect(mockRepo.update).toHaveBeenCalledWith(TIERED_MEMBER.brother, {
        role_ids: [ROLE.brother, ROLE.pledge],
      });
    });

    it("refuses a role below the chair that carries a permission the chair lacks, so a second account can't collect it", async () => {
      // The treasury assistant ranks with the brothers but holds billing:view.
      await expect(
        save(
          TIERED_MEMBER.brother,
          [ROLE.brother, ROLE.treasuryAssistant],
          USER.riskChair,
        ),
      ).rejects.toThrow(/billing:view/);
      await expect(
        save(
          TIERED_MEMBER.brother,
          [ROLE.brother, ROLE.alumni],
          USER.riskChair,
        ),
      ).rejects.toThrow(/alumni:post/);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('lets an exec officer make a brother a chair, and the President do anything', async () => {
      await save(
        TIERED_MEMBER.brother,
        [ROLE.brother, ROLE.socialChair],
        USER.vicePresident,
      );
      await save(TIERED_MEMBER.vicePresident, [ROLE.treasurer], USER.president);
      expect(mockRepo.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('remove', () => {
    const existingMember = memberFixture({
      chapter_id: 'chapter-1',
      role_ids: ['role-1'],
      has_completed_onboarding: true,
    });

    it('removes a member belonging to the active chapter', async () => {
      mockRepo.findById.mockResolvedValue(existingMember);
      mockRepo.delete.mockResolvedValue(undefined);

      await service.remove('member-1', 'chapter-1', 'actor-1');

      expect(mockRepo.findById).toHaveBeenCalledWith('member-1');
      expect(mockRepo.delete).toHaveBeenCalledWith('member-1');
    });

    // #1302: a re-invite creates a new `members` row for the same `users.id`,
    // so an id left in a PRIVATE channel's `member_ids` would let the member
    // straight back in, full history included.
    it("takes the member off the chapter's PRIVATE channels, before the row goes", async () => {
      mockRepo.findById.mockResolvedValue(existingMember);
      mockRepo.delete.mockResolvedValue(undefined);

      await service.remove('member-1', 'chapter-1', 'actor-1');

      expect(
        mockChannelRepo.removeUserFromPrivateChannels,
      ).toHaveBeenCalledWith('chapter-1', 'user-1');
      expect(
        mockChannelRepo.removeUserFromPrivateChannels.mock
          .invocationCallOrder[0],
      ).toBeLessThan(mockRepo.delete.mock.invocationCallOrder[0]);
    });

    it('evicts every pruned channel from the push cache and records them in the audit entry', async () => {
      // A re-invite inside the cache's TTL would otherwise be pushed from the
      // pre-prune list, and the audit entry is how an officer learns which
      // channels to add a mistakenly removed member back to.
      mockRepo.findById.mockResolvedValue(existingMember);
      mockRepo.delete.mockResolvedValue(undefined);
      mockChannelRepo.removeUserFromPrivateChannels.mockResolvedValue([
        'chan-a',
        'chan-b',
      ]);

      await service.remove('member-1', 'chapter-1', 'actor-1');

      expect(mockChannelCache.invalidate).toHaveBeenCalledWith('chan-a');
      expect(mockChannelCache.invalidate).toHaveBeenCalledWith('chan-b');
      expect(mockAuditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          diff: {
            user_id: existingMember.user_id,
            private_channel_ids: ['chan-a', 'chan-b'],
          },
        }),
      );
    });

    it('does not remove the member when their channels cannot be updated', async () => {
      // Blocking is retryable; removing the row first would leave ids behind
      // that no later removal of this member could reach.
      mockRepo.findById.mockResolvedValue(existingMember);
      mockChannelRepo.removeUserFromPrivateChannels.mockRejectedValue(
        new Error('pg down'),
      );

      await expect(
        service.remove('member-1', 'chapter-1', 'actor-1'),
      ).rejects.toThrow('pg down');
      expect(mockRepo.delete).not.toHaveBeenCalled();
    });

    it('writes a chapter_audit_log entry after a successful removal', async () => {
      mockRepo.findById.mockResolvedValue(existingMember);
      mockRepo.delete.mockResolvedValue(undefined);

      await service.remove('member-1', 'chapter-1', 'actor-1');

      expect(mockAuditLogService.record).toHaveBeenCalledWith({
        chapterId: 'chapter-1',
        actorUserId: 'actor-1',
        action: 'member_removed',
        targetType: 'member',
        targetId: 'member-1',
        diff: { user_id: existingMember.user_id, private_channel_ids: [] },
      });
    });

    // #349: removing the President is one of the two ways a chapter can be
    // orphaned (spec/behavior/rbac.md § Presidency Transfer "Edge case").
    it('checks whether the removed member held the President role', async () => {
      mockRepo.findById.mockResolvedValue(existingMember);
      mockRepo.delete.mockResolvedValue(undefined);

      await service.remove('member-1', 'chapter-1', 'actor-1');

      expect(mockRbacService.flagIfPresidentRemoved).toHaveBeenCalledWith(
        'chapter-1',
        existingMember.role_ids,
        'actor-1',
      );
    });

    it('throws when member is not found', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(
        service.remove('member-x', 'chapter-1', 'actor-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockRepo.delete).not.toHaveBeenCalled();
      expect(mockAuditLogService.record).not.toHaveBeenCalled();
      expect(mockRbacService.flagIfPresidentRemoved).not.toHaveBeenCalled();
    });

    it('throws when member belongs to a different chapter', async () => {
      mockRepo.findById.mockResolvedValue({
        ...existingMember,
        chapter_id: 'chapter-other',
      });

      await expect(
        service.remove('member-1', 'chapter-1', 'actor-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRepo.delete).not.toHaveBeenCalled();
      expect(mockAuditLogService.record).not.toHaveBeenCalled();
      expect(mockRbacService.flagIfPresidentRemoved).not.toHaveBeenCalled();
    });

    // #711: closes the ex-chapter avatar residue — removal used to delete
    // only the membership row and leave every profile photo behind.
    describe('profile-photo purge', () => {
      it("lists and deletes the removed member's photo folder in this chapter", async () => {
        mockRepo.findById.mockResolvedValue(existingMember);
        mockRepo.delete.mockResolvedValue(undefined);
        mockStorageProvider.listFiles.mockResolvedValue([
          'chapters/chapter-1/profiles/user-1/photo.jpg',
        ]);

        await service.remove('member-1', 'chapter-1', 'actor-1');

        expect(mockStorageProvider.listFiles).toHaveBeenCalledWith(
          'profiles',
          'chapters/chapter-1/profiles/user-1',
        );
        expect(mockStorageProvider.deleteFiles).toHaveBeenCalledWith(
          'profiles',
          ['chapters/chapter-1/profiles/user-1/photo.jpg'],
        );
      });

      it('skips deleteFiles when the folder is empty', async () => {
        mockRepo.findById.mockResolvedValue(existingMember);
        mockRepo.delete.mockResolvedValue(undefined);
        mockStorageProvider.listFiles.mockResolvedValue([]);

        await service.remove('member-1', 'chapter-1', 'actor-1');

        expect(mockStorageProvider.deleteFiles).not.toHaveBeenCalled();
      });

      it('purges storage before deleting the membership row', async () => {
        mockRepo.findById.mockResolvedValue(existingMember);
        mockRepo.delete.mockResolvedValue(undefined);
        mockStorageProvider.listFiles.mockResolvedValue([
          'chapters/chapter-1/profiles/user-1/photo.jpg',
        ]);
        const order: string[] = [];
        mockStorageProvider.deleteFiles.mockImplementation(async () => {
          order.push('storage-purged');
        });
        mockRepo.delete.mockImplementation(async () => {
          order.push('member-deleted');
        });

        await service.remove('member-1', 'chapter-1', 'actor-1');

        expect(order).toEqual(['storage-purged', 'member-deleted']);
      });

      // No independent sweep reaps orphaned profile photos (unlike report
      // exports, which the 24h retention sweep covers), so a purge failure
      // must block the removal rather than silently orphan the objects.
      it('blocks the removal — does not delete the row or write an audit entry — when the purge fails', async () => {
        mockRepo.findById.mockResolvedValue(existingMember);
        mockStorageProvider.listFiles.mockRejectedValue(
          new Error('storage unavailable'),
        );

        await expect(
          service.remove('member-1', 'chapter-1', 'actor-1'),
        ).rejects.toThrow('storage unavailable');
        expect(mockRepo.delete).not.toHaveBeenCalled();
        expect(mockAuditLogService.record).not.toHaveBeenCalled();
        expect(mockRbacService.flagIfPresidentRemoved).not.toHaveBeenCalled();
      });

      // avatar_url is a global column on `users`, not scoped to any one
      // chapter, and survives a chapter removal — found by diff-review:
      // purging the folder without also clearing a reference into it left a
      // still-active-elsewhere member with a permanently broken avatar.
      it("clears avatar_url when it points into the purged chapter's folder", async () => {
        mockRepo.findById.mockResolvedValue(existingMember);
        mockRepo.delete.mockResolvedValue(undefined);
        mockStorageProvider.listFiles.mockResolvedValue([
          'chapters/chapter-1/profiles/user-1/photo.jpg',
        ]);
        mockUserRepo.findById.mockResolvedValue({
          id: 'user-1',
          avatar_url: 'chapters/chapter-1/profiles/user-1/photo.jpg',
        } as User);

        await service.remove('member-1', 'chapter-1', 'actor-1');

        expect(mockUserRepo.update).toHaveBeenCalledWith('user-1', {
          avatar_url: null,
        });
      });

      it('leaves avatar_url alone when it points into a different chapter', async () => {
        mockRepo.findById.mockResolvedValue(existingMember);
        mockRepo.delete.mockResolvedValue(undefined);
        mockStorageProvider.listFiles.mockResolvedValue([]);
        mockUserRepo.findById.mockResolvedValue({
          id: 'user-1',
          avatar_url: 'chapters/chapter-other/profiles/user-1/photo.jpg',
        } as User);

        await service.remove('member-1', 'chapter-1', 'actor-1');

        expect(mockUserRepo.update).not.toHaveBeenCalled();
      });

      it('leaves avatar_url alone when the user has none set', async () => {
        mockRepo.findById.mockResolvedValue(existingMember);
        mockRepo.delete.mockResolvedValue(undefined);
        mockStorageProvider.listFiles.mockResolvedValue([]);
        mockUserRepo.findById.mockResolvedValue({
          id: 'user-1',
          avatar_url: null,
        } as User);

        await service.remove('member-1', 'chapter-1', 'actor-1');

        expect(mockUserRepo.update).not.toHaveBeenCalled();
      });
    });
  });

  // Removal follows the rank rules (#4071): never yourself, and only members
  // ranked below you unless you hold `*`.
  describe('remove rank rules', () => {
    const members = tieredChapterMembers();
    const memberRow = (id: string) => members.find((m) => m.id === id)!;
    const removeAs = (memberId: string, actorUserId: string) => {
      mockRepo.findById.mockResolvedValue(memberRow(memberId));
      mockRepo.delete.mockResolvedValue(undefined);
      mockRbacService.getRankContext.mockResolvedValue(
        tieredRankContext(actorUserId),
      );
      return service.remove(memberId, CHAPTER_ID, actorUserId);
    };

    it('stops the President removing themselves', async () => {
      await expect(
        removeAs(TIERED_MEMBER.president, USER.president),
      ).rejects.toThrow("You can't remove yourself from the chapter.");
      expect(mockRepo.delete).not.toHaveBeenCalled();
    });

    it('stops an officer removing themselves', async () => {
      await expect(
        removeAs(TIERED_MEMBER.vicePresident, USER.vicePresident),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockRepo.delete).not.toHaveBeenCalled();
    });

    it('stops a chair removing an officer', async () => {
      await expect(
        removeAs(TIERED_MEMBER.vicePresident, USER.riskChair),
      ).rejects.toThrow('You can only remove members ranked below you.');
      expect(mockRepo.delete).not.toHaveBeenCalled();
    });

    it('stops an officer removing the President', async () => {
      await expect(
        removeAs(TIERED_MEMBER.president, USER.vicePresident),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockRepo.delete).not.toHaveBeenCalled();
    });

    it('lets an officer remove a brother', async () => {
      await removeAs(TIERED_MEMBER.brother, USER.vicePresident);
      expect(mockRepo.delete).toHaveBeenCalledWith(TIERED_MEMBER.brother);
    });

    it('lets the President remove an officer', async () => {
      await removeAs(TIERED_MEMBER.vicePresident, USER.president);
      expect(mockRepo.delete).toHaveBeenCalledWith(TIERED_MEMBER.vicePresident);
    });
  });

  describe('viewer_can_remove', () => {
    const members = tieredChapterMembers();
    const memberRow = (id: string) => members.find((m) => m.id === id)!;
    const profileAs = (
      memberId: string,
      viewerUserId: string,
      permissions: string[],
    ) => {
      mockRepo.findById.mockResolvedValue(memberRow(memberId));
      mockUserRepo.findById.mockResolvedValue(userFixture());
      mockRbacService.getEffectivePermissions.mockResolvedValue(permissions);
      mockRbacService.getRankContext.mockResolvedValue(
        tieredRankContext(viewerUserId),
      );
      return service.findProfileById(memberId, CHAPTER_ID, viewerUserId);
    };

    it('is false, without a rank read, for a viewer without members:remove', async () => {
      const profile = await profileAs(TIERED_MEMBER.brother, USER.riskChair, [
        'members:view',
      ]);
      expect(profile.viewer_can_remove).toBe(false);
      expect(mockRbacService.getRankContext).not.toHaveBeenCalled();
    });

    it("is false on the President's own profile", async () => {
      const profile = await profileAs(TIERED_MEMBER.president, USER.president, [
        '*',
      ]);
      expect(profile.viewer_can_remove).toBe(false);
    });

    it('is true for an officer viewing a brother', async () => {
      const profile = await profileAs(
        TIERED_MEMBER.brother,
        USER.vicePresident,
        ['members:view', 'members:remove'],
      );
      expect(profile.viewer_can_remove).toBe(true);
    });

    it('is true for a wildcard holder viewing someone else, without a rank read', async () => {
      const profile = await profileAs(TIERED_MEMBER.brother, USER.president, [
        '*',
      ]);
      expect(profile.viewer_can_remove).toBe(true);
      expect(mockRbacService.getRankContext).not.toHaveBeenCalled();
    });

    it('answers false, and still serves the profile, when the rank read fails', async () => {
      mockRepo.findById.mockResolvedValue(memberRow(TIERED_MEMBER.brother));
      mockUserRepo.findById.mockResolvedValue(userFixture());
      mockRbacService.getEffectivePermissions.mockResolvedValue([
        'members:view',
        'members:remove',
      ]);
      mockRbacService.getRankContext.mockRejectedValue(new Error('tiers down'));
      const profile = await service.findProfileById(
        TIERED_MEMBER.brother,
        CHAPTER_ID,
        USER.vicePresident,
      );
      expect(profile.viewer_can_remove).toBe(false);
    });

    it('is false for an officer viewing the President', async () => {
      const profile = await profileAs(
        TIERED_MEMBER.president,
        USER.vicePresident,
        ['members:view', 'members:remove'],
      );
      expect(profile.viewer_can_remove).toBe(false);
    });
  });

  // #4367: officers fix a member's name and graduation year.
  describe('correctProfile', () => {
    const members = tieredChapterMembers();
    const memberRow = (id: string) => members.find((m) => m.id === id)!;
    const correctAs = (
      memberId: string,
      actorUserId: string,
      changes: { display_name?: string; graduation_year?: number | null },
    ) => {
      const row = memberRow(memberId);
      mockRepo.findById.mockResolvedValue(row);
      mockUserRepo.findById.mockResolvedValue(
        userFixture({
          id: row.user_id,
          display_name: 'Jonh Smith',
          graduation_year: 2026,
        }),
      );
      mockUserRepo.update.mockResolvedValue(userFixture());
      mockRbacService.getRankContext.mockResolvedValue(
        tieredRankContext(actorUserId),
      );
      return service.correctProfile(memberId, CHAPTER_ID, actorUserId, changes);
    };

    it("lets an officer fix a brother's name and year, and audits the change", async () => {
      await correctAs(TIERED_MEMBER.brother, USER.vicePresident, {
        display_name: 'John Smith',
        graduation_year: 2027,
      });
      const row = memberRow(TIERED_MEMBER.brother);
      expect(mockUserRepo.update).toHaveBeenCalledWith(row.user_id, {
        display_name: 'John Smith',
        graduation_year: 2027,
      });
      expect(mockAuditLogService.record).toHaveBeenCalledWith({
        chapterId: CHAPTER_ID,
        actorUserId: USER.vicePresident,
        action: 'member_profile_corrected',
        targetType: 'member',
        targetId: TIERED_MEMBER.brother,
        diff: {
          display_name: { from: 'Jonh Smith', to: 'John Smith' },
          graduation_year: { from: 2026, to: 2027 },
        },
      });
    });

    it('writes and audits only what changed', async () => {
      await correctAs(TIERED_MEMBER.brother, USER.vicePresident, {
        display_name: 'Jonh Smith',
        graduation_year: null,
      });
      expect(mockUserRepo.update).toHaveBeenCalledWith(expect.any(String), {
        graduation_year: null,
      });
      expect(mockAuditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          diff: { graduation_year: { from: 2026, to: null } },
        }),
      );
    });

    it('writes nothing when nothing changed', async () => {
      await correctAs(TIERED_MEMBER.brother, USER.vicePresident, {
        display_name: 'Jonh Smith',
      });
      expect(mockUserRepo.update).not.toHaveBeenCalled();
      expect(mockAuditLogService.record).not.toHaveBeenCalled();
    });

    it('refuses your own profile', async () => {
      await expect(
        correctAs(TIERED_MEMBER.vicePresident, USER.vicePresident, {
          display_name: 'VP',
        }),
      ).rejects.toThrow(
        'Change your own name and graduation year from your profile.',
      );
      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });

    it('stops a chair renaming an officer', async () => {
      await expect(
        correctAs(TIERED_MEMBER.vicePresident, USER.riskChair, {
          display_name: 'Someone',
        }),
      ).rejects.toThrow(
        'You can only edit the profiles of members ranked below you.',
      );
      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });

    it('stops an officer renaming the President', async () => {
      await expect(
        correctAs(TIERED_MEMBER.president, USER.vicePresident, {
          display_name: 'Someone',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a member who is also in another chapter', async () => {
      mockRepo.findByUser.mockResolvedValue([
        memberRow(TIERED_MEMBER.brother),
        memberFixture({ id: 'elsewhere', chapter_id: 'other-chapter' }),
      ]);
      await expect(
        correctAs(TIERED_MEMBER.brother, USER.president, {
          display_name: 'Someone',
        }),
      ).rejects.toThrow('This member is also in another chapter');
      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });

    it('refuses a member of another chapter', async () => {
      mockRepo.findById.mockResolvedValue(
        memberFixture({ chapter_id: 'other-chapter' }),
      );
      await expect(
        service.correctProfile('member-1', CHAPTER_ID, USER.president, {
          display_name: 'X',
        }),
      ).rejects.toThrow('Member not in current chapter');
    });
  });

  describe('viewer_can_edit_profile', () => {
    const members = tieredChapterMembers();
    const memberRow = (id: string) => members.find((m) => m.id === id)!;
    const profileAs = (
      memberId: string,
      viewerUserId: string,
      permissions: string[],
    ) => {
      mockRepo.findById.mockResolvedValue(memberRow(memberId));
      mockUserRepo.findById.mockResolvedValue(userFixture());
      mockRbacService.getEffectivePermissions.mockResolvedValue(permissions);
      mockRbacService.getRankContext.mockResolvedValue(
        tieredRankContext(viewerUserId),
      );
      return service.findProfileById(memberId, CHAPTER_ID, viewerUserId);
    };

    it('is false, with no reads, for a viewer without roles:manage', async () => {
      const profile = await profileAs(TIERED_MEMBER.brother, USER.riskChair, [
        'members:view',
      ]);
      expect(profile.viewer_can_edit_profile).toBe(false);
      expect(mockRepo.findByUser).not.toHaveBeenCalled();
    });

    it('is true for an officer with roles:manage viewing a brother', async () => {
      const profile = await profileAs(
        TIERED_MEMBER.brother,
        USER.vicePresident,
        ['members:view', 'roles:manage'],
      );
      expect(profile.viewer_can_edit_profile).toBe(true);
    });

    it('is false for that officer viewing the President', async () => {
      const profile = await profileAs(
        TIERED_MEMBER.president,
        USER.vicePresident,
        ['members:view', 'roles:manage'],
      );
      expect(profile.viewer_can_edit_profile).toBe(false);
    });

    it('is false on your own profile', async () => {
      const profile = await profileAs(TIERED_MEMBER.president, USER.president, [
        '*',
      ]);
      expect(profile.viewer_can_edit_profile).toBe(false);
    });

    it('is true for a wildcard holder, false once the member is in another chapter', async () => {
      const first = await profileAs(TIERED_MEMBER.brother, USER.president, [
        '*',
      ]);
      expect(first.viewer_can_edit_profile).toBe(true);
      mockRepo.findByUser.mockResolvedValue([
        memberFixture({ id: 'elsewhere', chapter_id: 'other-chapter' }),
      ]);
      const second = await profileAs(TIERED_MEMBER.brother, USER.president, [
        '*',
      ]);
      expect(second.viewer_can_edit_profile).toBe(false);
    });

    it('reads the rank context once when both removal and correction need it', async () => {
      mockRbacService.getRankContext.mockClear();
      const profile = await profileAs(
        TIERED_MEMBER.brother,
        USER.vicePresident,
        ['members:view', 'roles:manage', 'members:remove'],
      );
      expect(profile.viewer_can_edit_profile).toBe(true);
      expect(profile.viewer_can_remove).toBe(true);
      expect(mockRbacService.getRankContext).toHaveBeenCalledTimes(1);
    });

    it('carries the phone the member set', async () => {
      mockRepo.findById.mockResolvedValue(memberRow(TIERED_MEMBER.brother));
      mockUserRepo.findById.mockResolvedValue(
        userFixture({ phone: '(518) 555-0142' }),
      );
      const profile = await service.findProfileById(
        TIERED_MEMBER.brother,
        CHAPTER_ID,
        USER.riskChair,
      );
      expect(profile.phone).toBe('(518) 555-0142');
    });
  });

  describe('findProfileByUserId', () => {
    it("reads the profile of the user's membership in this chapter", async () => {
      const member = memberFixture({
        chapter_id: 'chapter-1',
        has_completed_onboarding: true,
      });
      mockRepo.findByUserAndChapter.mockResolvedValue(member);
      mockUserRepo.findById.mockResolvedValue(
        userFixture({ display_name: 'John Doe' }),
      );

      const result = await service.findProfileByUserId(
        'user-1',
        'chapter-1',
        'viewer-1',
      );

      expect(mockRepo.findByUserAndChapter).toHaveBeenCalledWith(
        'user-1',
        'chapter-1',
      );
      expect(result).toMatchObject({
        id: 'member-1',
        user_id: 'user-1',
        display_name: 'John Doe',
      });
      // Built from the chapter-scoped row, not read a second time by id.
      expect(mockRepo.findById).not.toHaveBeenCalled();
    });

    it('answers 404 for a user with no membership in this chapter', async () => {
      mockRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        service.findProfileByUserId('user-9', 'chapter-1', 'viewer-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockRepo.findById).not.toHaveBeenCalled();
    });
  });

  describe('findProfileById', () => {
    it('should return member profile with user info', async () => {
      const member = memberFixture({
        chapter_id: 'chapter-1',
        role_ids: ['role-1'],
        has_completed_onboarding: true,
      });
      const user = userFixture({
        email: 'john@example.com',
        display_name: 'John Doe',
        bio: 'Engineer',
        graduation_year: 2024,
        current_city: 'NYC',
        current_company: 'Acme',
      });
      mockRepo.findById.mockResolvedValue(member);
      mockUserRepo.findById.mockResolvedValue(user);

      const result = await service.findProfileById(
        'member-1',
        'chapter-1',
        'viewer-1',
      );

      expect(mockRepo.findById).toHaveBeenCalledWith('member-1');
      expect(mockUserRepo.findById).toHaveBeenCalledWith('user-1');
      expect(result).toMatchObject({
        id: 'member-1',
        user_id: 'user-1',
        chapter_id: 'chapter-1',
        display_name: 'John Doe',
        email: 'john@example.com',
        bio: 'Engineer',
        graduation_year: 2024,
        current_city: 'NYC',
        current_company: 'Acme',
        custom_fields: [],
      });
    });

    it("serves the member's uploaded photo as a signed URL (#732)", async () => {
      const path = 'chapters/chapter-1/profiles/user-1/p.png';
      mockRepo.findById.mockResolvedValue(
        memberFixture({
          chapter_id: 'chapter-1',
          has_completed_onboarding: true,
        }),
      );
      mockUserRepo.findById.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.c',
        display_name: 'A',
        avatar_url: path,
      } as User);

      const result = await service.findProfileById(
        'member-1',
        'chapter-1',
        'viewer-1',
      );

      expect(result.avatar_url).toBe(`signed:${path}`);
    });

    it('passes the viewer-allowed visibility set to the custom-field lookup', async () => {
      const member = memberFixture({
        chapter_id: 'chapter-1',
        role_ids: ['role-1'],
        has_completed_onboarding: true,
      });
      mockRepo.findById.mockResolvedValue(member);
      mockUserRepo.findById.mockResolvedValue(
        userFixture({
          email: 'john@example.com',
          display_name: 'John Doe',
        }),
      );

      // A different viewer (not self) who is the president (wildcard).
      mockRbacService.getEffectivePermissions.mockResolvedValue(['*']);
      mockCustomFieldService.findVisibleValuesForMember.mockResolvedValue([
        {
          field_id: 'f1',
          key: 'gpa',
          label: 'GPA',
          type: 'decimal',
          visibility: 'president',
          value: '3.9',
        },
      ]);

      const result = await service.findProfileById(
        'member-1',
        'chapter-1',
        'president-user',
      );

      expect(mockRbacService.getEffectivePermissions).toHaveBeenCalledWith(
        'chapter-1',
        'president-user',
      );
      const [, , allowed] =
        mockCustomFieldService.findVisibleValuesForMember.mock.calls[0];
      // President (wildcard), viewing someone else: chapter + exec + president,
      // but NOT self.
      expect(Array.from(allowed as Set<string>).sort()).toEqual([
        'chapter',
        'exec',
        'president',
      ]);
      expect(result.custom_fields).toHaveLength(1);
    });

    it('should throw NotFoundException when member not found', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(
        service.findProfileById('member-x', 'chapter-1', 'viewer-1'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.findProfileById('member-x', 'chapter-1', 'viewer-1'),
      ).rejects.toThrow('Member not found');
    });

    it('should throw ForbiddenException when member not in chapter', async () => {
      mockRepo.findById.mockResolvedValue(
        memberFixture({
          chapter_id: 'chapter-other',
        }),
      );

      await expect(
        service.findProfileById('member-1', 'chapter-1', 'viewer-1'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.findProfileById('member-1', 'chapter-1', 'viewer-1'),
      ).rejects.toThrow('Member not in current chapter');
    });
  });

  describe('searchByChapterAndName', () => {
    it('should return matching members by display name', async () => {
      const members = [
        memberFixture({
          chapter_id: 'chapter-1',
          has_completed_onboarding: true,
        }),
      ];
      const users = [
        userFixture({
          email: 'john@example.com',
          display_name: 'John Doe',
        }),
      ];
      mockRepo.findByChapter.mockResolvedValue(members);
      mockUserRepo.findByIds.mockResolvedValue(users);

      const result = await service.searchByChapterAndName(
        'chapter-1',
        'john',
        'viewer-user-1',
      );

      expect(mockRepo.findByChapter).toHaveBeenCalledWith('chapter-1');
      expect(mockUserRepo.findByIds).toHaveBeenCalledWith(['user-1']);
      expect(result).toHaveLength(1);
      expect(result[0].display_name).toBe('John Doe');
    });

    it('should return empty array when no members match', async () => {
      mockRepo.findByChapter.mockResolvedValue([]);

      const result = await service.searchByChapterAndName(
        'chapter-1',
        'xyz',
        'viewer-user-1',
      );

      expect(result).toEqual([]);
    });

    it('should match on email as well as display name (#588)', async () => {
      const members = [
        memberFixture({
          chapter_id: 'chapter-1',
          has_completed_onboarding: true,
        }),
      ];
      const users = [
        userFixture({
          email: 'jdoe@school.edu',
          display_name: 'Jane Roe',
        }),
      ];
      mockRepo.findByChapter.mockResolvedValue(members);
      mockUserRepo.findByIds.mockResolvedValue(users);

      const result = await service.searchByChapterAndName(
        'chapter-1',
        'jdoe@school',
        'viewer-user-1',
      );

      expect(result).toHaveLength(1);
      expect(result[0].email).toBe('jdoe@school.edu');
    });

    it('should match a member solely by a visible custom-field value', async () => {
      const members = [
        memberFixture({
          chapter_id: 'chapter-1',
          has_completed_onboarding: true,
        }),
      ];
      const users = [
        userFixture({
          email: 'john@example.com',
          display_name: 'John Doe',
        }),
      ];
      mockRepo.findByChapter.mockResolvedValue(members);
      mockUserRepo.findByIds.mockResolvedValue(users);
      mockRbacService.getEffectivePermissions.mockResolvedValue([
        'members:view',
      ]);
      mockCustomFieldService.findFieldIdsByVisibility.mockResolvedValue([
        { id: 'field-1', visibility: 'chapter' },
      ]);
      mockCustomFieldService.findValuesByFieldIds.mockResolvedValue([
        {
          member_id: 'member-1',
          field_id: 'field-1',
          value: 'Mechanical Engineering',
        },
      ]);

      const result = await service.searchByChapterAndName(
        'chapter-1',
        'mechanical',
        'viewer-user-1',
      );

      expect(
        mockCustomFieldService.findFieldIdsByVisibility,
      ).toHaveBeenCalledWith('chapter-1', new Set(['chapter', 'self']));
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('member-1');
    });

    it('never matches an exec-tier field value for a baseline member viewer (#588)', async () => {
      const members = [
        memberFixture({
          chapter_id: 'chapter-1',
          has_completed_onboarding: true,
        }),
      ];
      const users = [
        userFixture({
          email: 'john@example.com',
          display_name: 'John Doe',
        }),
      ];
      mockRepo.findByChapter.mockResolvedValue(members);
      mockUserRepo.findByIds.mockResolvedValue(users);
      // Baseline member: members:view only, so allowedVisibilities() never
      // includes 'exec' — the exec-tier field must not even be a candidate.
      mockRbacService.getEffectivePermissions.mockResolvedValue([
        'members:view',
      ]);

      await service.searchByChapterAndName(
        'chapter-1',
        'secret',
        'viewer-user-2',
      );

      expect(
        mockCustomFieldService.findFieldIdsByVisibility,
      ).toHaveBeenCalledWith('chapter-1', new Set(['chapter', 'self']));
    });

    it('matches a self-tier field value only on the viewer’s own row', async () => {
      const members = [
        memberFixture({
          user_id: 'viewer-user-1',
          chapter_id: 'chapter-1',
          has_completed_onboarding: true,
        }),
        memberFixture({
          id: 'member-2',
          user_id: 'user-2',
          chapter_id: 'chapter-1',
          has_completed_onboarding: true,
        }),
      ];
      const users = [
        userFixture({
          id: 'viewer-user-1',
          email: 'me@example.com',
          display_name: 'Me',
        }),
        userFixture({
          id: 'user-2',
          supabase_auth_id: 'auth-2',
          email: 'them@example.com',
          display_name: 'Them',
        }),
      ];
      mockRepo.findByChapter.mockResolvedValue(members);
      mockUserRepo.findByIds.mockResolvedValue(users);
      mockRbacService.getEffectivePermissions.mockResolvedValue([
        'members:view',
      ]);
      mockCustomFieldService.findFieldIdsByVisibility.mockResolvedValue([
        { id: 'field-self', visibility: 'self' },
      ]);
      // Both the viewer's own row and another member's row hold a matching
      // value on the self-tier field — only the viewer's own row may match.
      mockCustomFieldService.findValuesByFieldIds.mockResolvedValue([
        {
          member_id: 'member-1',
          field_id: 'field-self',
          value: 'private note',
        },
        {
          member_id: 'member-2',
          field_id: 'field-self',
          value: 'private note',
        },
      ]);

      const result = await service.searchByChapterAndName(
        'chapter-1',
        'private',
        'viewer-user-1',
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('member-1');
    });
  });

  // #732: every public member read hands clients a signed URL, never the bare
  // private-bucket path, which renders nothing. One case per read, so dropping
  // the signing from any one of them fails here.
  describe('every member read signs the stored photo path', () => {
    const PHOTO = 'chapters/chapter-1/profiles/user-1/p.jpg';
    const member = memberFixture({
      chapter_id: 'chapter-1',
      role_ids: ['role-alumni'],
      has_completed_onboarding: true,
    });
    const user = userFixture({
      email: 'ann@example.com',
      display_name: 'Ann Lee',
      avatar_url: PHOTO,
      graduation_year: 2020,
    });

    beforeEach(() => {
      mockRepo.findByChapter.mockResolvedValue([member]);
      mockUserRepo.findByIds.mockResolvedValue([user]);
      mockUserRepo.findDisplayIdentitiesByIds.mockResolvedValue([
        { id: 'user-1', display_name: 'Ann Lee', avatar_url: PHOTO },
      ]);
      mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue(
        roleFixture({
          id: 'role-alumni',
          chapter_id: 'chapter-1',
          name: 'Alumni',
          is_system: true,
          display_order: 5,
        }),
      );
    });

    it.each([
      [
        'the directory (findByChapter)',
        () => service.findByChapter('chapter-1'),
      ],
      [
        'the activity feed roster (findRosterWithJoinDates)',
        () => service.findRosterWithJoinDates('chapter-1'),
      ],
      [
        'search (searchByChapterAndName)',
        () => service.searchByChapterAndName('chapter-1', 'ann', 'viewer-1'),
      ],
      [
        'the alumni directory (findAlumniByChapter)',
        () => service.findAlumniByChapter('chapter-1'),
      ],
    ])('%s', async (_label, read) => {
      const rows = await read();

      expect(rows.map((row) => row.avatar_url)).toEqual([`signed:${PHOTO}`]);
    });
  });

  describe('findAlumniByChapter', () => {
    it('should return alumni members with profile info', async () => {
      const alumniRole = roleFixture({
        id: 'role-alumni',
        chapter_id: 'chapter-1',
        name: 'Alumni',
        is_system: true,
        display_order: 5,
      });
      const members = [
        memberFixture({
          chapter_id: 'chapter-1',
          role_ids: ['role-alumni'],
          has_completed_onboarding: true,
        }),
      ];
      const users = [
        userFixture({
          email: 'alumni@example.com',
          display_name: 'Alumni User',
          graduation_year: 2022,
          current_city: 'Boston',
          current_company: 'Tech Corp',
        }),
      ];
      mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue(alumniRole);
      mockRepo.findByChapter.mockResolvedValue(members);
      mockUserRepo.findByIds.mockResolvedValue(users);

      const result = await service.findAlumniByChapter('chapter-1');

      expect(mockRoleRepo.findByChapterAndSystemKey).toHaveBeenCalledWith(
        'chapter-1',
        SystemRoleKeys.ALUMNI,
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        display_name: 'Alumni User',
        graduation_year: 2022,
        current_city: 'Boston',
        current_company: 'Tech Corp',
      });
    });

    it('should filter alumni by graduation_year', async () => {
      const alumniRole = roleFixture({
        id: 'role-alumni',
        chapter_id: 'chapter-1',
        name: 'Alumni',
        is_system: true,
        display_order: 5,
      });
      const members = [
        memberFixture({
          chapter_id: 'chapter-1',
          role_ids: ['role-alumni'],
          has_completed_onboarding: true,
        }),
        memberFixture({
          id: 'member-2',
          user_id: 'user-2',
          chapter_id: 'chapter-1',
          role_ids: ['role-alumni'],
          has_completed_onboarding: true,
        }),
      ];
      const users = [
        userFixture({
          email: 'a@example.com',
          display_name: 'User 1',
          graduation_year: 2022,
        }),
        userFixture({
          id: 'user-2',
          supabase_auth_id: 'auth-2',
          email: 'b@example.com',
          display_name: 'User 2',
          graduation_year: 2023,
        }),
      ];
      mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue(alumniRole);
      mockRepo.findByChapter.mockResolvedValue(members);
      mockUserRepo.findByIds.mockResolvedValue(users);

      const result = await service.findAlumniByChapter('chapter-1', {
        graduation_year: 2022,
      });

      expect(result).toHaveLength(1);
      expect(result[0].graduation_year).toBe(2022);
    });

    it('should return empty array when no Alumni role exists', async () => {
      mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue(null);

      const result = await service.findAlumniByChapter('chapter-1');

      expect(result).toEqual([]);
    });
  });

  // #2484: the directories split actives from alumni on this flag, so it has
  // to agree with `findAlumniByChapter` member for member — otherwise a
  // chapter's "Actives" and "Alumni" counts could overlap or leave someone out.
  describe('is_alumni', () => {
    const alumniRole = roleFixture({
      id: 'role-alumni',
      chapter_id: 'chapter-1',
      name: 'Alumni',
      system_key: SystemRoleKeys.ALUMNI,
      is_system: true,
      display_order: 5,
    });
    const memberRow = (id: string, roleIds: string[]) =>
      memberFixture({
        id,
        user_id: `user-of-${id}`,
        chapter_id: 'chapter-1',
        role_ids: roleIds,
        has_completed_onboarding: true,
      });
    const userRow = (memberId: string, name: string) =>
      userFixture({
        id: `user-of-${memberId}`,
        supabase_auth_id: `auth-of-${memberId}`,
        email: `${memberId}@example.com`,
        display_name: name,
      });
    const members = [
      memberRow('active', ['role-member']),
      memberRow('alumnus', ['role-alumni']),
      // Both roles at once: the Alumni role is what the lifecycle rule keys
      // on (spec/behavior/alumni.md), so this member is an alumnus.
      memberRow('both', ['role-member', 'role-alumni']),
    ];
    const users = [
      userRow('active', 'Active Member'),
      userRow('alumnus', 'Alumnus'),
      userRow('both', 'Both Roles'),
    ];

    beforeEach(() => {
      mockRepo.findByChapter.mockResolvedValue(members);
      mockUserRepo.findByIds.mockResolvedValue(users);
    });

    it('flags exactly the members GET /alumni returns', async () => {
      mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue(alumniRole);

      const listed = await service.findByChapter('chapter-1');
      const alumni = await service.findAlumniByChapter('chapter-1');

      expect(
        Object.fromEntries(listed.map((m) => [m.id, m.is_alumni])),
      ).toEqual({ active: false, alumnus: true, both: true });
      expect(alumni.map((m) => m.id).sort()).toEqual(
        listed
          .filter((m) => m.is_alumni)
          .map((m) => m.id)
          .sort(),
      );
      expect(alumni.every((m) => m.is_alumni)).toBe(true);
      // Through the lookup the alumni restrictions use, not a copy of it.
      expect(mockRbacService.getAlumniRoleId).toHaveBeenCalledWith('chapter-1');
    });

    it('is false for everyone when the chapter has no keyed Alumni role', async () => {
      mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue(null);

      const listed = await service.findByChapter('chapter-1');

      expect(listed.map((m) => m.is_alumni)).toEqual([false, false, false]);
      await expect(service.findAlumniByChapter('chapter-1')).resolves.toEqual(
        [],
      );
    });

    it('rides search results, so a searched Actives list can filter too', async () => {
      mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue(alumniRole);

      const result = await service.searchByChapterAndName(
        'chapter-1',
        'alumnus',
        'user-of-active',
      );

      expect(result).toEqual([
        expect.objectContaining({ id: 'alumnus', is_alumni: true }),
      ]);
    });

    it('rides the single-member read', async () => {
      mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue(alumniRole);
      mockRepo.findById.mockResolvedValue(members[1]);
      mockUserRepo.findById.mockResolvedValue(users[1]);

      const result = await service.findProfileById(
        'alumnus',
        'chapter-1',
        'user-of-active',
      );

      expect(result).toMatchObject({ id: 'alumnus', is_alumni: true });
    });
  });

  describe('dismissOpsNudge', () => {
    const member = memberFixture({
      chapter_id: 'chapter-1',
      role_ids: ['role-1'],
      has_completed_onboarding: true,
    });

    it('appends the module key to the member row', async () => {
      mockRepo.findById.mockResolvedValue(member);
      mockRepo.update.mockResolvedValue({
        ...member,
        dismissed_ops_nudges: ['dues'],
      });

      await service.dismissOpsNudge('member-1', 'dues');

      expect(mockRepo.update).toHaveBeenCalledWith('member-1', {
        dismissed_ops_nudges: ['dues'],
      });
    });

    it('preserves nudges already dismissed', async () => {
      mockRepo.findById.mockResolvedValue({
        ...member,
        dismissed_ops_nudges: ['dues'],
      });
      mockRepo.update.mockResolvedValue({} as Member);

      await service.dismissOpsNudge('member-1', 'events');

      expect(mockRepo.update).toHaveBeenCalledWith('member-1', {
        dismissed_ops_nudges: ['dues', 'events'],
      });
    });

    // Idempotent, and specifically by *not writing*. A retried request or a
    // double-click must not grow the column with a duplicate entry — the array
    // is read back by `selectOpsNudge` and would still behave, but it would
    // grow without bound over a member's lifetime.
    it('does not write when the nudge is already dismissed', async () => {
      mockRepo.findById.mockResolvedValue({
        ...member,
        dismissed_ops_nudges: ['dues'],
      });

      const result = await service.dismissOpsNudge('member-1', 'dues');

      expect(mockRepo.update).not.toHaveBeenCalled();
      expect(result.dismissed_ops_nudges).toEqual(['dues']);
    });

    // The column was added after these rows existed, so a row read back from a
    // fixture or an older cache has no array at all. Spreading `undefined`
    // would throw before the write ever happened.
    it('tolerates a row predating the column', async () => {
      mockRepo.findById.mockResolvedValue({
        ...member,
        dismissed_ops_nudges: undefined as unknown as string[],
      });
      mockRepo.update.mockResolvedValue({} as Member);

      await service.dismissOpsNudge('member-1', 'points');

      expect(mockRepo.update).toHaveBeenCalledWith('member-1', {
        dismissed_ops_nudges: ['points'],
      });
    });

    it('throws when the member does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.dismissOpsNudge('missing', 'dues')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockRepo.update).not.toHaveBeenCalled();
    });
  });
});
