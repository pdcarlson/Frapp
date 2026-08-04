import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { RbacService } from './rbac.service';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import type { IRoleRepository } from '../../domain/repositories/role.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import {
  ALUMNI_ROLE_NAME,
  SystemPermissions,
} from '../../domain/constants/permissions';
import { CustomRoleService } from './custom-role.service';
import type { Role } from '../../domain/entities/role.entity';
import type { Member } from '../../domain/entities/member.entity';

describe('RbacService', () => {
  let service: RbacService;
  let mockRoleRepo: jest.Mocked<IRoleRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;
  let mockCustomRoleService: { findByIds: jest.Mock };

  beforeEach(async () => {
    mockRoleRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      findByIds: jest.fn(),
      findByChapterAndName: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockMemberRepo = {
      findById: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      transferPresidencyAtomic: jest.fn(),
    };

    mockCustomRoleService = {
      findByIds: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacService,
        { provide: ROLE_REPOSITORY, useValue: mockRoleRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: CustomRoleService, useValue: mockCustomRoleService },
      ],
    }).compile();

    service = module.get(RbacService);
  });

  it('should list roles for chapter', async () => {
    const roles: Role[] = [
      {
        id: 'role-1',
        chapter_id: 'ch-1',
        name: 'President',
        permissions: [SystemPermissions.WILDCARD],
        is_system: true,
        display_order: 1,
        color: '#FFD700',
        created_at: '2024-01-01',
      },
    ];
    mockRoleRepo.findByChapter.mockResolvedValue(roles);

    const result = await service.findByChapter('ch-1');

    expect(mockRoleRepo.findByChapter).toHaveBeenCalledWith('ch-1');
    expect(result).toEqual(roles);
  });

  it('should create custom role', async () => {
    const role: Role = {
      id: 'role-1',
      chapter_id: 'ch-1',
      name: 'Custom',
      permissions: ['members:view'],
      is_system: false,
      display_order: 10,
      color: null,
      created_at: '2024-01-01',
    };
    mockRoleRepo.findByChapterAndName.mockResolvedValue(null);
    mockRoleRepo.create.mockResolvedValue(role);

    const result = await service.create('ch-1', {
      name: 'Custom',
      permissions: ['members:view'],
      display_order: 10,
    });

    expect(mockRoleRepo.findByChapterAndName).toHaveBeenCalledWith(
      'ch-1',
      'Custom',
    );
    expect(mockRoleRepo.create).toHaveBeenCalledWith({
      name: 'Custom',
      permissions: ['members:view'],
      display_order: 10,
      chapter_id: 'ch-1',
      is_system: false,
    });
    expect(result).toEqual(role);
  });

  it('should reject duplicate role name', async () => {
    const existing: Role = {
      id: 'role-1',
      chapter_id: 'ch-1',
      name: 'Custom',
      permissions: [],
      is_system: false,
      display_order: 0,
      color: null,
      created_at: '2024-01-01',
    };
    mockRoleRepo.findByChapterAndName.mockResolvedValue(existing);

    await expect(
      service.create('ch-1', { name: 'Custom', permissions: [] }),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.create('ch-1', { name: 'Custom', permissions: [] }),
    ).rejects.toThrow('Role name already exists in this chapter');
  });

  it('should update role', async () => {
    const role: Role = {
      id: 'role-1',
      chapter_id: 'ch-1',
      name: 'Custom',
      permissions: ['members:view'],
      is_system: false,
      display_order: 10,
      color: null,
      created_at: '2024-01-01',
    };
    const updated: Role = {
      ...role,
      name: 'Custom Updated',
      permissions: ['members:view', 'members:invite'],
    };
    mockRoleRepo.findById.mockResolvedValue(role);
    mockRoleRepo.findByChapterAndName.mockResolvedValue(null);
    mockRoleRepo.update.mockResolvedValue(updated);

    const result = await service.update('role-1', 'ch-1', {
      name: 'Custom Updated',
      permissions: ['members:view', 'members:invite'],
    });

    expect(mockRoleRepo.update).toHaveBeenCalledWith('role-1', {
      name: 'Custom Updated',
      permissions: ['members:view', 'members:invite'],
    });
    expect(result).toEqual(updated);
  });

  it('should reject updating a role from another chapter', async () => {
    const role: Role = {
      id: 'role-1',
      chapter_id: 'ch-other',
      name: 'Custom',
      permissions: ['members:view'],
      is_system: false,
      display_order: 10,
      color: null,
      created_at: '2024-01-01',
    };
    mockRoleRepo.findById.mockResolvedValue(role);

    await expect(
      service.update('role-1', 'ch-1', { name: 'Hijacked' }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.update('role-1', 'ch-1', { name: 'Hijacked' }),
    ).rejects.toThrow('Role not in current chapter');
    expect(mockRoleRepo.update).not.toHaveBeenCalled();
  });

  it('should reject rename to existing name', async () => {
    const role: Role = {
      id: 'role-1',
      chapter_id: 'ch-1',
      name: 'Custom',
      permissions: [],
      is_system: false,
      display_order: 0,
      color: null,
      created_at: '2024-01-01',
    };
    const existingOther: Role = {
      id: 'role-2',
      chapter_id: 'ch-1',
      name: 'Other',
      permissions: [],
      is_system: false,
      display_order: 0,
      color: null,
      created_at: '2024-01-01',
    };
    mockRoleRepo.findById.mockResolvedValue(role);
    mockRoleRepo.findByChapterAndName.mockResolvedValue(existingOther);

    await expect(
      service.update('role-1', 'ch-1', { name: 'Other' }),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.update('role-1', 'ch-1', { name: 'Other' }),
    ).rejects.toThrow('Role name already exists in this chapter');
  });

  it('should delete custom role', async () => {
    const role: Role = {
      id: 'role-1',
      chapter_id: 'ch-1',
      name: 'Custom',
      permissions: [],
      is_system: false,
      display_order: 0,
      color: null,
      created_at: '2024-01-01',
    };
    mockRoleRepo.findById.mockResolvedValue(role);
    mockRoleRepo.delete.mockResolvedValue(undefined);

    await service.delete('role-1', 'ch-1');

    expect(mockRoleRepo.delete).toHaveBeenCalledWith('role-1');
  });

  it('should reject deleting a role from another chapter', async () => {
    const role: Role = {
      id: 'role-1',
      chapter_id: 'ch-other',
      name: 'Custom',
      permissions: [],
      is_system: false,
      display_order: 0,
      color: null,
      created_at: '2024-01-01',
    };
    mockRoleRepo.findById.mockResolvedValue(role);

    await expect(service.delete('role-1', 'ch-1')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.delete('role-1', 'ch-1')).rejects.toThrow(
      'Role not in current chapter',
    );
    expect(mockRoleRepo.delete).not.toHaveBeenCalled();
  });

  it('should prevent deletion of system roles', async () => {
    const role: Role = {
      id: 'role-1',
      chapter_id: 'ch-1',
      name: 'President',
      permissions: [SystemPermissions.WILDCARD],
      is_system: true,
      display_order: 1,
      color: '#FFD700',
      created_at: '2024-01-01',
    };
    mockRoleRepo.findById.mockResolvedValue(role);

    await expect(service.delete('role-1', 'ch-1')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.delete('role-1', 'ch-1')).rejects.toThrow(
      'Cannot delete system roles',
    );
    expect(mockRoleRepo.delete).not.toHaveBeenCalled();
  });

  describe('transferPresidency', () => {
    const presidentRole: Role = {
      id: 'role-president',
      chapter_id: 'ch-1',
      name: 'President',
      permissions: [SystemPermissions.WILDCARD],
      is_system: true,
      display_order: 1,
      color: '#FFD700',
      created_at: '2024-01-01',
    };

    const makeMember = (overrides: Partial<Member>): Member => ({
      id: 'member-x',
      user_id: 'user-x',
      chapter_id: 'ch-1',
      role_ids: [],
      custom_role_ids: [],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      ...overrides,
    });

    it('moves the wildcard role to the target in a single atomic RPC call', async () => {
      const currentMember = makeMember({
        id: 'member-1',
        user_id: 'user-1',
        role_ids: [presidentRole.id],
      });
      const targetMember = makeMember({
        id: 'member-2',
        user_id: 'user-2',
        role_ids: ['role-member'],
      });
      mockMemberRepo.findById
        .mockResolvedValueOnce(currentMember)
        .mockResolvedValueOnce(targetMember);
      mockRoleRepo.findByChapter.mockResolvedValue([presidentRole]);
      mockMemberRepo.transferPresidencyAtomic.mockResolvedValue(true);

      await service.transferPresidency('ch-1', 'member-1', 'member-2');

      // One atomic call replaces the previous two independent member updates.
      expect(mockMemberRepo.transferPresidencyAtomic).toHaveBeenCalledTimes(1);
      expect(mockMemberRepo.transferPresidencyAtomic).toHaveBeenCalledWith(
        'ch-1',
        'member-1',
        'member-2',
        presidentRole.id,
      );
      expect(mockMemberRepo.update).not.toHaveBeenCalled();
    });

    it('rejects a self-transfer (current === target) as a bad request', async () => {
      await expect(
        service.transferPresidency('ch-1', 'member-1', 'member-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockMemberRepo.findById).not.toHaveBeenCalled();
      expect(mockMemberRepo.transferPresidencyAtomic).not.toHaveBeenCalled();
    });

    it('rejects a transfer initiated by a non-president without touching the DB', async () => {
      const currentMember = makeMember({
        id: 'member-1',
        user_id: 'user-1',
        role_ids: ['role-member'],
      });
      const targetMember = makeMember({ id: 'member-2', user_id: 'user-2' });
      mockMemberRepo.findById.mockImplementation((id) =>
        Promise.resolve(
          id === 'member-1'
            ? currentMember
            : id === 'member-2'
              ? targetMember
              : null,
        ),
      );
      mockRoleRepo.findByChapter.mockResolvedValue([presidentRole]);

      await expect(
        service.transferPresidency('ch-1', 'member-1', 'member-2'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.transferPresidency('ch-1', 'member-1', 'member-2'),
      ).rejects.toThrow('Only the current President can transfer presidency');
      expect(mockMemberRepo.transferPresidencyAtomic).not.toHaveBeenCalled();
    });

    it('throws NotFound when the target member does not exist', async () => {
      const currentMember = makeMember({
        id: 'member-1',
        user_id: 'user-1',
        role_ids: [presidentRole.id],
      });
      mockMemberRepo.findById
        .mockResolvedValueOnce(currentMember)
        .mockResolvedValueOnce(null);

      await expect(
        service.transferPresidency('ch-1', 'member-1', 'missing'),
      ).rejects.toThrow(NotFoundException);
      expect(mockMemberRepo.transferPresidencyAtomic).not.toHaveBeenCalled();
    });

    it('throws BadRequest when the target is in a different chapter', async () => {
      const currentMember = makeMember({
        id: 'member-1',
        user_id: 'user-1',
        role_ids: [presidentRole.id],
      });
      const targetMember = makeMember({
        id: 'member-2',
        user_id: 'user-2',
        chapter_id: 'ch-2',
      });
      mockMemberRepo.findById
        .mockResolvedValueOnce(currentMember)
        .mockResolvedValueOnce(targetMember);

      await expect(
        service.transferPresidency('ch-1', 'member-1', 'member-2'),
      ).rejects.toThrow(BadRequestException);
      expect(mockMemberRepo.transferPresidencyAtomic).not.toHaveBeenCalled();
    });

    it('throws NotFound when the chapter has no President role', async () => {
      const currentMember = makeMember({
        id: 'member-1',
        user_id: 'user-1',
        role_ids: ['role-member'],
      });
      const targetMember = makeMember({ id: 'member-2', user_id: 'user-2' });
      mockMemberRepo.findById
        .mockResolvedValueOnce(currentMember)
        .mockResolvedValueOnce(targetMember);
      mockRoleRepo.findByChapter.mockResolvedValue([]);

      await expect(
        service.transferPresidency('ch-1', 'member-1', 'member-2'),
      ).rejects.toThrow('President role not found');
      expect(mockMemberRepo.transferPresidencyAtomic).not.toHaveBeenCalled();
    });

    it('maps a false RPC result (stale/concurrent transfer) to Forbidden', async () => {
      const currentMember = makeMember({
        id: 'member-1',
        user_id: 'user-1',
        role_ids: [presidentRole.id],
      });
      const targetMember = makeMember({
        id: 'member-2',
        user_id: 'user-2',
        role_ids: ['role-member'],
      });
      mockMemberRepo.findById
        .mockResolvedValueOnce(currentMember)
        .mockResolvedValueOnce(targetMember);
      mockRoleRepo.findByChapter.mockResolvedValue([presidentRole]);
      mockMemberRepo.transferPresidencyAtomic.mockResolvedValue(false);

      await expect(
        service.transferPresidency('ch-1', 'member-1', 'member-2'),
      ).rejects.toThrow('Only the current President can transfer presidency');
    });

    it('propagates a repository/transaction failure (rollback handled in the DB)', async () => {
      const currentMember = makeMember({
        id: 'member-1',
        user_id: 'user-1',
        role_ids: [presidentRole.id],
      });
      const targetMember = makeMember({
        id: 'member-2',
        user_id: 'user-2',
        role_ids: ['role-member'],
      });
      mockMemberRepo.findById
        .mockResolvedValueOnce(currentMember)
        .mockResolvedValueOnce(targetMember);
      mockRoleRepo.findByChapter.mockResolvedValue([presidentRole]);
      mockMemberRepo.transferPresidencyAtomic.mockRejectedValue(
        new Error('db boom'),
      );

      await expect(
        service.transferPresidency('ch-1', 'member-1', 'member-2'),
      ).rejects.toThrow('db boom');
    });
  });

  it('should return permissions catalog', () => {
    const result = service.getPermissionsCatalog();

    expect(result).toEqual(
      Object.entries(SystemPermissions).map(([key, value]) => ({
        key,
        permission: value,
      })),
    );
    expect(
      result.some((r) => r.key === 'WILDCARD' && r.permission === '*'),
    ).toBe(true);
  });

  describe('memberHasAnyPermission', () => {
    const member: Member = {
      id: 'member-1',
      user_id: 'user-1',
      chapter_id: 'ch-1',
      role_ids: ['role-foreign'],
      custom_role_ids: [],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };

    it('resolves roles within the chapter, so a foreign role id grants nothing', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);
      // The chapter-scoped lookup drops the cross-chapter id, even though the
      // role it points at carries the wildcard in its own chapter.
      mockRoleRepo.findByIds.mockResolvedValue([]);

      const result = await service.memberHasAnyPermission('ch-1', 'user-1', [
        SystemPermissions.ROLES_MANAGE,
      ]);

      expect(mockRoleRepo.findByIds).toHaveBeenCalledWith(
        ['role-foreign'],
        'ch-1',
      );
      expect(result).toBe(false);
    });
  });

  describe('getEffectivePermissions', () => {
    const buildMember = (
      role_ids: string[],
      custom_role_ids: string[] = [],
    ): Member => ({
      id: 'member-1',
      user_id: 'user-1',
      chapter_id: 'ch-1',
      role_ids,
      custom_role_ids,
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    });

    const buildRole = (id: string, permissions: string[]): Role => ({
      id,
      chapter_id: 'ch-1',
      name: `role-${id}`,
      permissions,
      is_system: false,
      display_order: 10,
      color: null,
      created_at: '2024-01-01',
    });

    it('returns empty array when user is not a member of the chapter', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      const result = await service.getEffectivePermissions('ch-1', 'user-1');

      expect(result).toEqual([]);
      expect(mockRoleRepo.findByIds).not.toHaveBeenCalled();
    });

    it('returns empty array when member has no role ids', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(buildMember([]));

      const result = await service.getEffectivePermissions('ch-1', 'user-1');

      expect(result).toEqual([]);
      expect(mockRoleRepo.findByIds).not.toHaveBeenCalled();
    });

    it('flattens and de-duplicates permissions across multiple roles', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(
        buildMember(['role-a', 'role-b']),
      );
      mockRoleRepo.findByIds.mockResolvedValue([
        buildRole('role-a', [
          SystemPermissions.MEMBERS_VIEW,
          SystemPermissions.EVENTS_CREATE,
        ]),
        buildRole('role-b', [
          SystemPermissions.MEMBERS_VIEW,
          SystemPermissions.BILLING_VIEW,
        ]),
      ]);

      const result = await service.getEffectivePermissions('ch-1', 'user-1');

      expect(result).toEqual(
        [
          SystemPermissions.BILLING_VIEW,
          SystemPermissions.EVENTS_CREATE,
          SystemPermissions.MEMBERS_VIEW,
        ].sort(),
      );
      expect(mockRoleRepo.findByIds).toHaveBeenCalledWith(
        ['role-a', 'role-b'],
        'ch-1',
      );
    });

    it('scopes role resolution to the chapter so a foreign role id resolves to nothing', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(
        buildMember(['role-foreign']),
      );
      // A stale or cross-chapter id survives on `members.role_ids`; the
      // chapter-scoped lookup matches no row, so no permissions leak through.
      mockRoleRepo.findByIds.mockResolvedValue([]);

      const result = await service.getEffectivePermissions('ch-1', 'user-1');

      expect(mockRoleRepo.findByIds).toHaveBeenCalledWith(
        ['role-foreign'],
        'ch-1',
      );
      expect(result).toEqual([]);
    });

    it('includes wildcard for President-style roles', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(
        buildMember(['role-president']),
      );
      mockRoleRepo.findByIds.mockResolvedValue([
        buildRole('role-president', [SystemPermissions.WILDCARD]),
      ]);

      const result = await service.getEffectivePermissions('ch-1', 'user-1');

      expect(result).toEqual([SystemPermissions.WILDCARD]);
    });

    it('tolerates roles with null permissions arrays', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(
        buildMember(['role-broken']),
      );
      const broken = buildRole('role-broken', []);
      // Simulate a database row where permissions came back as null rather
      // than an empty array — the service must not crash.
      (broken as unknown as { permissions: string[] | null }).permissions =
        null;
      mockRoleRepo.findByIds.mockResolvedValue([broken]);

      const result = await service.getEffectivePermissions('ch-1', 'user-1');

      expect(result).toEqual([]);
    });

    // Bridge model (spec/behavior/rbac.md): custom-role capabilities flatten
    // into the same effective set as live-role permissions.
    it('includes custom-role capabilities alongside live-role permissions', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(
        buildMember(['role-a'], ['custom-1']),
      );
      mockRoleRepo.findByIds.mockResolvedValue([
        buildRole('role-a', [SystemPermissions.MEMBERS_VIEW]),
      ]);
      mockCustomRoleService.findByIds.mockResolvedValue([
        {
          id: 'custom-1',
          chapter_id: 'ch-1',
          key: 'social_chair',
          label: 'Social Chair',
          rank: 5,
          capabilities: [
            SystemPermissions.EVENTS_CREATE,
            SystemPermissions.EVENTS_UPDATE,
          ],
          core: false,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ]);

      const result = await service.getEffectivePermissions('ch-1', 'user-1');

      expect(mockCustomRoleService.findByIds).toHaveBeenCalledWith(
        ['custom-1'],
        'ch-1',
      );
      expect(result).toEqual(
        [
          SystemPermissions.EVENTS_CREATE,
          SystemPermissions.EVENTS_UPDATE,
          SystemPermissions.MEMBERS_VIEW,
        ].sort(),
      );
    });

    it('resolves capabilities for a member holding only custom roles', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(
        buildMember([], ['custom-1']),
      );
      mockCustomRoleService.findByIds.mockResolvedValue([
        {
          id: 'custom-1',
          chapter_id: 'ch-1',
          key: 'historian',
          label: 'Historian',
          rank: 9,
          capabilities: [SystemPermissions.CHAPTER_DOCS_UPLOAD],
          core: false,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ]);

      const result = await service.getEffectivePermissions('ch-1', 'user-1');

      expect(result).toEqual([SystemPermissions.CHAPTER_DOCS_UPLOAD]);
      expect(mockRoleRepo.findByIds).not.toHaveBeenCalled();
    });

    it('drops the wildcard from custom-role capabilities (pre-validation data)', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(
        buildMember([], ['custom-evil']),
      );
      mockCustomRoleService.findByIds.mockResolvedValue([
        {
          id: 'custom-evil',
          chapter_id: 'ch-1',
          key: 'shadow_president',
          label: 'Shadow President',
          rank: 0,
          capabilities: [
            SystemPermissions.WILDCARD,
            SystemPermissions.MEMBERS_VIEW,
          ],
          core: false,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ]);

      const result = await service.getEffectivePermissions('ch-1', 'user-1');

      // Only the live President role may carry `*`; a custom role must never
      // mint a second wildcard holder outside the presidency-transfer flow.
      expect(result).toEqual([SystemPermissions.MEMBERS_VIEW]);

      const granted = await service.memberHasAnyPermission('ch-1', 'user-1', [
        SystemPermissions.BILLING_MANAGE,
      ]);
      expect(granted).toBe(false);
    });

    it('scopes custom-role resolution to the chapter so a foreign id grants nothing', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(
        buildMember([], ['custom-foreign']),
      );
      // The chapter-scoped lookup drops the cross-chapter id.
      mockCustomRoleService.findByIds.mockResolvedValue([]);

      const result = await service.getEffectivePermissions('ch-1', 'user-1');

      expect(mockCustomRoleService.findByIds).toHaveBeenCalledWith(
        ['custom-foreign'],
        'ch-1',
      );
      expect(result).toEqual([]);
    });
  });

  // The Alumni role is a lifecycle marker, not a permission level: study hours,
  // event check-in, and most chat posting are denied by holding it.
  // See spec/behavior/alumni.md.
  describe('isAlumni / hasAlumniRole', () => {
    const alumniRole: Role = {
      id: 'role-alumni',
      chapter_id: 'ch-1',
      name: ALUMNI_ROLE_NAME,
      permissions: [SystemPermissions.MEMBERS_VIEW],
      is_system: true,
      display_order: 7,
      color: '#6B7280',
      created_at: '2024-01-01',
    };

    const memberWithRoles = (role_ids: string[]): Member => ({
      id: 'member-1',
      user_id: 'user-1',
      chapter_id: 'ch-1',
      role_ids,
      custom_role_ids: [],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    });

    it('returns true when the member holds the Alumni role', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(
        memberWithRoles(['role-alumni']),
      );
      mockRoleRepo.findByChapterAndName.mockResolvedValue(alumniRole);

      await expect(service.isAlumni('ch-1', 'user-1')).resolves.toBe(true);
      expect(mockRoleRepo.findByChapterAndName).toHaveBeenCalledWith(
        'ch-1',
        ALUMNI_ROLE_NAME,
      );
    });

    it('returns false for an active member holding other roles', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(
        memberWithRoles(['role-member']),
      );
      mockRoleRepo.findByChapterAndName.mockResolvedValue(alumniRole);

      await expect(service.isAlumni('ch-1', 'user-1')).resolves.toBe(false);
    });

    it('returns false when the caller is not a member of the chapter', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(service.isAlumni('ch-1', 'user-1')).resolves.toBe(false);
      // No role lookup needed when there is no membership.
      expect(mockRoleRepo.findByChapterAndName).not.toHaveBeenCalled();
    });

    it('fails open to normal permissions when the chapter has no Alumni role', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(
        memberWithRoles(['role-alumni']),
      );
      mockRoleRepo.findByChapterAndName.mockResolvedValue(null);

      await expect(service.isAlumni('ch-1', 'user-1')).resolves.toBe(false);
    });

    it('hasAlumniRole resolves from caller-supplied role ids without a member lookup', async () => {
      mockRoleRepo.findByChapterAndName.mockResolvedValue(alumniRole);

      await expect(
        service.hasAlumniRole('ch-1', ['role-alumni']),
      ).resolves.toBe(true);
      expect(mockMemberRepo.findByUserAndChapter).not.toHaveBeenCalled();
    });

    it('hasAlumniRole short-circuits on empty or missing role ids', async () => {
      await expect(service.hasAlumniRole('ch-1', [])).resolves.toBe(false);
      await expect(service.hasAlumniRole('ch-1', null)).resolves.toBe(false);
      await expect(service.hasAlumniRole('ch-1', undefined)).resolves.toBe(
        false,
      );
      expect(mockRoleRepo.findByChapterAndName).not.toHaveBeenCalled();
    });
  });
});
