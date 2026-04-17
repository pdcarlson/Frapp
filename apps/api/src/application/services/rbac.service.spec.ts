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
import { SystemPermissions } from '../../domain/constants/permissions';
import type { Role } from '../../domain/entities/role.entity';
import type { Member } from '../../domain/entities/member.entity';

describe('RbacService', () => {
  let service: RbacService;
  let mockRoleRepo: jest.Mocked<IRoleRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;

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
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacService,
        { provide: ROLE_REPOSITORY, useValue: mockRoleRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
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

    const result = await service.update('role-1', {
      name: 'Custom Updated',
      permissions: ['members:view', 'members:invite'],
    });

    expect(mockRoleRepo.update).toHaveBeenCalledWith('role-1', {
      name: 'Custom Updated',
      permissions: ['members:view', 'members:invite'],
    });
    expect(result).toEqual(updated);
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

    await expect(service.update('role-1', { name: 'Other' })).rejects.toThrow(
      ConflictException,
    );
    await expect(service.update('role-1', { name: 'Other' })).rejects.toThrow(
      'Role name already exists in this chapter',
    );
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

    await service.delete('role-1');

    expect(mockRoleRepo.delete).toHaveBeenCalledWith('role-1');
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

    await expect(service.delete('role-1')).rejects.toThrow(ForbiddenException);
    await expect(service.delete('role-1')).rejects.toThrow(
      'Cannot delete system roles',
    );
    expect(mockRoleRepo.delete).not.toHaveBeenCalled();
  });

  it('should transfer presidency atomically', async () => {
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
    const currentMember: Member = {
      id: 'member-1',
      user_id: 'user-1',
      chapter_id: 'ch-1',
      role_ids: [presidentRole.id],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    const targetMember: Member = {
      id: 'member-2',
      user_id: 'user-2',
      chapter_id: 'ch-1',
      role_ids: ['role-member'],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockMemberRepo.findById
      .mockResolvedValueOnce(currentMember)
      .mockResolvedValueOnce(targetMember);
    mockRoleRepo.findByChapter.mockResolvedValue([presidentRole]);
    mockMemberRepo.update.mockResolvedValue({} as Member);

    await service.transferPresidency('ch-1', 'member-1', 'member-2');

    expect(mockMemberRepo.update).toHaveBeenCalledWith('member-1', {
      role_ids: [],
    });
    expect(mockMemberRepo.update).toHaveBeenCalledWith('member-2', {
      role_ids: ['role-member', presidentRole.id],
    });
  });

  it('should reject transfer from non-president', async () => {
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
    const currentMember: Member = {
      id: 'member-1',
      user_id: 'user-1',
      chapter_id: 'ch-1',
      role_ids: ['role-member'],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    const targetMember: Member = {
      id: 'member-2',
      user_id: 'user-2',
      chapter_id: 'ch-1',
      role_ids: [],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
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
    expect(mockMemberRepo.update).not.toHaveBeenCalled();
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

  describe('getEffectivePermissions', () => {
    const buildMember = (role_ids: string[]): Member => ({
      id: 'member-1',
      user_id: 'user-1',
      chapter_id: 'ch-1',
      role_ids,
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
      expect(mockRoleRepo.findByIds).toHaveBeenCalledWith(['role-a', 'role-b']);
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
  });
});
