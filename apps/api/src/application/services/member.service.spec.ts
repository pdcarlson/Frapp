import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { MemberService } from './member.service';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import type { IRoleRepository } from '../../domain/repositories/role.repository.interface';
import { SystemRoleKeys } from '../../domain/constants/permissions';
import { CustomFieldService } from './custom-field.service';
import { CustomRoleService } from './custom-role.service';
import { RbacService } from './rbac.service';
import { ChapterAuditLogService } from './chapter-audit-log.service';

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
  let mockCustomRoleService: { findByIds: jest.Mock };
  let mockRbacService: { getEffectivePermissions: jest.Mock };
  let mockAuditLogService: { record: jest.Mock };

  beforeEach(async () => {
    mockRepo = {
      findById: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockUserRepo = {
      findById: jest.fn(),
      findByIds: jest.fn(),
      findDisplayIdentitiesByIds: jest.fn(),
      findBySupabaseAuthId: jest.fn(),
      findByEmail: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      anonymize: jest.fn(),
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

    mockCustomFieldService = {
      findVisibleValuesForMember: jest.fn().mockResolvedValue([]),
      findFieldIdsByVisibility: jest.fn().mockResolvedValue([]),
      findValuesByFieldIds: jest.fn().mockResolvedValue([]),
    };
    mockCustomRoleService = {
      findByIds: jest.fn().mockResolvedValue([]),
    };
    mockRbacService = {
      getEffectivePermissions: jest.fn().mockResolvedValue([]),
    };
    mockAuditLogService = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberService,
        { provide: MEMBER_REPOSITORY, useValue: mockRepo },
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
        { provide: ROLE_REPOSITORY, useValue: mockRoleRepo },
        { provide: CustomFieldService, useValue: mockCustomFieldService },
        { provide: CustomRoleService, useValue: mockCustomRoleService },
        { provide: RbacService, useValue: mockRbacService },
        { provide: ChapterAuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get(MemberService);
  });

  it('should list member profiles by chapter', async () => {
    const members = [
      {
        id: 'member-1',
        user_id: 'user-1',
        chapter_id: 'chapter-1',
        role_ids: ['role-1'],
        custom_role_ids: [],
        has_completed_onboarding: true,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      },
    ];
    const users = [
      {
        id: 'user-1',
        supabase_auth_id: 'auth-1',
        email: 'john@example.com',
        display_name: 'John Doe',
        avatar_url: null,
        bio: null,
        graduation_year: null,
        current_city: null,
        current_company: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      },
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
    const member = {
      id: 'member-1',
      user_id: 'user-1',
      chapter_id: 'chapter-1',
      role_ids: ['role-1'],
      custom_role_ids: [],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
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
    const memberRow = (userId: string, id = `member-${userId}`) => ({
      id,
      user_id: userId,
      chapter_id: 'chapter-1',
      role_ids: ['role-1'],
      custom_role_ids: [],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
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
          avatar_url: 'https://example.test/a.png',
        },
      ]);

      const result = await service.findRosterByChapter('chapter-1');

      expect(result).toEqual([
        { user_id: 'user-1', display_name: 'Marcus Reid', avatar_url: null },
        {
          user_id: 'user-2',
          display_name: 'Dana Lowe',
          avatar_url: 'https://example.test/a.png',
        },
      ]);
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
        { user_id: 'user-1', display_name: 'Marcus Reid', avatar_url: null },
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
        { user_id: 'user-1', display_name: '', avatar_url: null },
      ]);
    });
  });

  describe('findRosterWithJoinDates', () => {
    const memberRow = (
      userId: string,
      createdAt: string,
      id = `member-${userId}`,
    ) => ({
      id,
      user_id: userId,
      chapter_id: 'chapter-1',
      role_ids: ['role-1'],
      custom_role_ids: [],
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
    const existingMember = {
      id: 'member-1',
      user_id: 'user-1',
      chapter_id: 'chapter-1',
      role_ids: ['role-1'],
      custom_role_ids: [],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    const presidentRole = {
      id: 'role-president',
      chapter_id: 'chapter-1',
      name: 'President',
      permissions: ['*'],
      is_system: true,
      display_order: 1,
      color: '#FFD700',
      created_at: '2024-01-01',
    };
    const memberRole = {
      id: 'role-1',
      chapter_id: 'chapter-1',
      name: 'Member',
      permissions: ['members:view'],
      is_system: true,
      display_order: 5,
      color: null,
      created_at: '2024-01-01',
    };
    const customRole = {
      id: 'role-2',
      chapter_id: 'chapter-1',
      name: 'Social Chair',
      permissions: ['events:create'],
      is_system: false,
      display_order: 8,
      color: null,
      created_at: '2024-01-01',
    };

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
      );

      expect(mockRepo.update).toHaveBeenCalledWith('member-1', {
        role_ids: ['role-1', 'role-2'],
      });
      expect(result).toEqual(updated);
    });

    it('throws when member is not found', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateRoles('member-x', ['role-1'], 'chapter-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when member belongs to a different chapter', async () => {
      mockRepo.findById.mockResolvedValue({
        ...existingMember,
        chapter_id: 'chapter-other',
      });

      await expect(
        service.updateRoles('member-1', ['role-1'], 'chapter-1'),
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
        service.updateRoles('member-1', ['role-1'], 'chapter-1'),
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
      );

      expect(mockRepo.update).toHaveBeenCalledWith('member-1', {
        role_ids: ['role-president', 'role-2'],
      });
      expect(result).toEqual(updated);
    });

    it('persists custom_role_ids after validating them against the chapter', async () => {
      mockRepo.findById.mockResolvedValue(existingMember);
      mockRoleRepo.findByChapter.mockResolvedValue([presidentRole, memberRole]);
      mockCustomRoleService.findByIds.mockResolvedValue([
        {
          id: 'custom-1',
          chapter_id: 'chapter-1',
          key: 'historian',
          label: 'Historian',
          rank: 9,
          capabilities: ['chapter_docs:upload'],
          core: false,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ]);
      const updated = {
        ...existingMember,
        custom_role_ids: ['custom-1'],
      };
      mockRepo.update.mockResolvedValue(updated);

      const result = await service.updateRoles(
        'member-1',
        ['role-1'],
        'chapter-1',
        ['custom-1'],
      );

      expect(mockCustomRoleService.findByIds).toHaveBeenCalledWith(
        ['custom-1'],
        'chapter-1',
      );
      expect(mockRepo.update).toHaveBeenCalledWith('member-1', {
        role_ids: ['role-1'],
        custom_role_ids: ['custom-1'],
      });
      expect(result).toEqual(updated);
    });

    it('rejects custom role IDs that do not belong to the chapter', async () => {
      mockRepo.findById.mockResolvedValue(existingMember);
      mockRoleRepo.findByChapter.mockResolvedValue([presidentRole, memberRole]);
      // The chapter-scoped lookup drops the foreign/fabricated id.
      mockCustomRoleService.findByIds.mockResolvedValue([]);

      await expect(
        service.updateRoles('member-1', ['role-1'], 'chapter-1', [
          'custom-foreign',
        ]),
      ).rejects.toThrow(BadRequestException);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('tolerates a stale custom role id the member already holds', async () => {
      // Deleting a custom role leaves its id on member rows by design (spec
      // fail-safe); a client echoing that leftover back must not have its
      // whole save rejected.
      mockRepo.findById.mockResolvedValue({
        ...existingMember,
        custom_role_ids: ['custom-deleted'],
      });
      mockRoleRepo.findByChapter.mockResolvedValue([presidentRole, memberRole]);
      mockCustomRoleService.findByIds.mockResolvedValue([]);
      const updated = {
        ...existingMember,
        custom_role_ids: ['custom-deleted'],
      };
      mockRepo.update.mockResolvedValue(updated);

      await service.updateRoles('member-1', ['role-1'], 'chapter-1', [
        'custom-deleted',
      ]);

      expect(mockRepo.update).toHaveBeenCalledWith('member-1', {
        role_ids: ['role-1'],
        custom_role_ids: ['custom-deleted'],
      });
    });

    it('tolerates a stale live-role id the member already holds', async () => {
      // Deleting a live role leaves its id on member rows (spec Edge Cases);
      // echoing it back must not fail the save — mirrors the custom-role rule.
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
      );

      expect(mockRepo.update).toHaveBeenCalledWith('member-1', {
        role_ids: ['role-1', 'role-deleted'],
      });
    });

    it('compares wildcard roles as sets: duplicates neither bypass nor false-403', async () => {
      // (a) A duplicated held president id must not mask adding a second
      // wildcard role, and (b) a duplicate in a no-op payload must not read
      // as a presidency change.
      const legacyWildcardRole = {
        id: 'role-legacy-star',
        chapter_id: 'chapter-1',
        name: 'Legacy Star',
        permissions: ['*'],
        is_system: false,
        display_order: 9,
        color: null,
        created_at: '2024-01-01',
      };
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
      );
      expect(mockRepo.update).toHaveBeenCalledWith('member-1', {
        role_ids: ['role-president', 'role-president', 'role-1'],
      });
    });

    it('blocks assigning a non-system role that carries the wildcard', async () => {
      // A legacy `*` role minted before wildcard writes were rejected must not
      // be attachable through the generic endpoint — the presidency-transfer
      // flow is the only path that moves wildcard access.
      const legacyWildcardRole = {
        id: 'role-legacy-star',
        chapter_id: 'chapter-1',
        name: 'Legacy Star',
        permissions: ['*'],
        is_system: false,
        display_order: 9,
        color: null,
        created_at: '2024-01-01',
      };
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
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('clears custom roles with an explicit empty array without a lookup', async () => {
      mockRepo.findById.mockResolvedValue(existingMember);
      mockRoleRepo.findByChapter.mockResolvedValue([presidentRole, memberRole]);
      const updated = { ...existingMember, custom_role_ids: [] };
      mockRepo.update.mockResolvedValue(updated);

      await service.updateRoles('member-1', ['role-1'], 'chapter-1', []);

      expect(mockCustomRoleService.findByIds).not.toHaveBeenCalled();
      expect(mockRepo.update).toHaveBeenCalledWith('member-1', {
        role_ids: ['role-1'],
        custom_role_ids: [],
      });
    });

    it('leaves custom_role_ids unchanged when the field is omitted', async () => {
      mockRepo.findById.mockResolvedValue(existingMember);
      mockRoleRepo.findByChapter.mockResolvedValue([presidentRole, memberRole]);
      const updated = { ...existingMember };
      mockRepo.update.mockResolvedValue(updated);

      await service.updateRoles('member-1', ['role-1'], 'chapter-1');

      expect(mockCustomRoleService.findByIds).not.toHaveBeenCalled();
      expect(mockRepo.update).toHaveBeenCalledWith('member-1', {
        role_ids: ['role-1'],
      });
    });
  });

  it('should update onboarding status', async () => {
    const updatedMember = {
      id: 'member-1',
      user_id: 'user-1',
      chapter_id: 'chapter-1',
      role_ids: ['role-1'],
      custom_role_ids: [],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-02',
    };
    mockRepo.update.mockResolvedValue(updatedMember);

    const result = await service.updateOnboarding('member-1', true);

    expect(mockRepo.update).toHaveBeenCalledWith('member-1', {
      has_completed_onboarding: true,
    });
    expect(result).toEqual(updatedMember);
  });

  describe('remove', () => {
    const existingMember = {
      id: 'member-1',
      user_id: 'user-1',
      chapter_id: 'chapter-1',
      role_ids: ['role-1'],
      custom_role_ids: [],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };

    it('removes a member belonging to the active chapter', async () => {
      mockRepo.findById.mockResolvedValue(existingMember);
      mockRepo.delete.mockResolvedValue(undefined);

      await service.remove('member-1', 'chapter-1', 'actor-1');

      expect(mockRepo.findById).toHaveBeenCalledWith('member-1');
      expect(mockRepo.delete).toHaveBeenCalledWith('member-1');
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
        diff: { user_id: existingMember.user_id },
      });
    });

    it('throws when member is not found', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(
        service.remove('member-x', 'chapter-1', 'actor-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockRepo.delete).not.toHaveBeenCalled();
      expect(mockAuditLogService.record).not.toHaveBeenCalled();
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
    });
  });

  describe('findProfileById', () => {
    it('should return member profile with user info', async () => {
      const member = {
        id: 'member-1',
        user_id: 'user-1',
        chapter_id: 'chapter-1',
        role_ids: ['role-1'],
        custom_role_ids: [],
        has_completed_onboarding: true,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };
      const user = {
        id: 'user-1',
        supabase_auth_id: 'auth-1',
        email: 'john@example.com',
        display_name: 'John Doe',
        avatar_url: null,
        bio: 'Engineer',
        graduation_year: 2024,
        current_city: 'NYC',
        current_company: 'Acme',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };
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

    it('passes the viewer-allowed visibility set to the custom-field lookup', async () => {
      const member = {
        id: 'member-1',
        user_id: 'user-1',
        chapter_id: 'chapter-1',
        role_ids: ['role-1'],
        custom_role_ids: [],
        has_completed_onboarding: true,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };
      mockRepo.findById.mockResolvedValue(member);
      mockUserRepo.findById.mockResolvedValue({
        id: 'user-1',
        supabase_auth_id: 'auth-1',
        email: 'john@example.com',
        display_name: 'John Doe',
        avatar_url: null,
        bio: null,
        graduation_year: null,
        current_city: null,
        current_company: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      });

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
      mockRepo.findById.mockResolvedValue({
        id: 'member-1',
        user_id: 'user-1',
        chapter_id: 'chapter-other',
        role_ids: [],
        custom_role_ids: [],
        has_completed_onboarding: false,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      });

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
        {
          id: 'member-1',
          user_id: 'user-1',
          chapter_id: 'chapter-1',
          role_ids: [],
          custom_role_ids: [],
          has_completed_onboarding: true,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      const users = [
        {
          id: 'user-1',
          supabase_auth_id: 'auth-1',
          email: 'john@example.com',
          display_name: 'John Doe',
          avatar_url: null,
          bio: null,
          graduation_year: null,
          current_city: null,
          current_company: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
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
        {
          id: 'member-1',
          user_id: 'user-1',
          chapter_id: 'chapter-1',
          role_ids: [],
          custom_role_ids: [],
          has_completed_onboarding: true,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      const users = [
        {
          id: 'user-1',
          supabase_auth_id: 'auth-1',
          email: 'jdoe@school.edu',
          display_name: 'Jane Roe',
          avatar_url: null,
          bio: null,
          graduation_year: null,
          current_city: null,
          current_company: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
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
        {
          id: 'member-1',
          user_id: 'user-1',
          chapter_id: 'chapter-1',
          role_ids: [],
          custom_role_ids: [],
          has_completed_onboarding: true,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      const users = [
        {
          id: 'user-1',
          supabase_auth_id: 'auth-1',
          email: 'john@example.com',
          display_name: 'John Doe',
          avatar_url: null,
          bio: null,
          graduation_year: null,
          current_city: null,
          current_company: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
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
        {
          id: 'member-1',
          user_id: 'user-1',
          chapter_id: 'chapter-1',
          role_ids: [],
          custom_role_ids: [],
          has_completed_onboarding: true,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      const users = [
        {
          id: 'user-1',
          supabase_auth_id: 'auth-1',
          email: 'john@example.com',
          display_name: 'John Doe',
          avatar_url: null,
          bio: null,
          graduation_year: null,
          current_city: null,
          current_company: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
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
        {
          id: 'member-1',
          user_id: 'viewer-user-1',
          chapter_id: 'chapter-1',
          role_ids: [],
          custom_role_ids: [],
          has_completed_onboarding: true,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 'member-2',
          user_id: 'user-2',
          chapter_id: 'chapter-1',
          role_ids: [],
          custom_role_ids: [],
          has_completed_onboarding: true,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      const users = [
        {
          id: 'viewer-user-1',
          supabase_auth_id: 'auth-1',
          email: 'me@example.com',
          display_name: 'Me',
          avatar_url: null,
          bio: null,
          graduation_year: null,
          current_city: null,
          current_company: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 'user-2',
          supabase_auth_id: 'auth-2',
          email: 'them@example.com',
          display_name: 'Them',
          avatar_url: null,
          bio: null,
          graduation_year: null,
          current_city: null,
          current_company: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
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

  describe('findAlumniByChapter', () => {
    it('should return alumni members with profile info', async () => {
      const alumniRole = {
        id: 'role-alumni',
        chapter_id: 'chapter-1',
        name: 'Alumni',
        permissions: [],
        is_system: true,
        display_order: 5,
        color: null,
        created_at: '2024-01-01',
      };
      const members = [
        {
          id: 'member-1',
          user_id: 'user-1',
          chapter_id: 'chapter-1',
          role_ids: ['role-alumni'],
          custom_role_ids: [],
          has_completed_onboarding: true,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      const users = [
        {
          id: 'user-1',
          supabase_auth_id: 'auth-1',
          email: 'alumni@example.com',
          display_name: 'Alumni User',
          avatar_url: null,
          bio: null,
          graduation_year: 2022,
          current_city: 'Boston',
          current_company: 'Tech Corp',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
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
      const alumniRole = {
        id: 'role-alumni',
        chapter_id: 'chapter-1',
        name: 'Alumni',
        permissions: [],
        is_system: true,
        display_order: 5,
        color: null,
        created_at: '2024-01-01',
      };
      const members = [
        {
          id: 'member-1',
          user_id: 'user-1',
          chapter_id: 'chapter-1',
          role_ids: ['role-alumni'],
          custom_role_ids: [],
          has_completed_onboarding: true,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 'member-2',
          user_id: 'user-2',
          chapter_id: 'chapter-1',
          role_ids: ['role-alumni'],
          custom_role_ids: [],
          has_completed_onboarding: true,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      const users = [
        {
          id: 'user-1',
          supabase_auth_id: 'auth-1',
          email: 'a@example.com',
          display_name: 'User 1',
          avatar_url: null,
          bio: null,
          graduation_year: 2022,
          current_city: null,
          current_company: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 'user-2',
          supabase_auth_id: 'auth-2',
          email: 'b@example.com',
          display_name: 'User 2',
          avatar_url: null,
          bio: null,
          graduation_year: 2023,
          current_city: null,
          current_company: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
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
});
