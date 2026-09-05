import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { RbacService } from './rbac.service';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import type { IRoleRepository } from '#domain/repositories/role.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '#domain/repositories/chapter.repository.interface';
import {
  ALUMNI_ROLE_NAME,
  SystemPermissions,
  SystemRoleKeys,
} from '#domain/constants/permissions';
import { CustomRoleService } from './custom-role.service';
import { ChapterAuditLogService } from './chapter-audit-log.service';
import type { Role } from '#domain/entities/role.entity';
import type { Member } from '#domain/entities/member.entity';
import type { Chapter } from '#domain/entities/chapter.entity';

describe('RbacService', () => {
  let service: RbacService;
  let mockRoleRepo: jest.Mocked<IRoleRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;
  let mockChapterRepo: jest.Mocked<IChapterRepository>;
  let mockCustomRoleService: { findByIds: jest.Mock };
  let mockChapterAuditLogService: { record: jest.Mock };

  beforeEach(async () => {
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

    mockMemberRepo = {
      findById: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      transferPresidencyAtomic: jest.fn(),
      claimPresidencyAtomic: jest.fn(),
    };

    mockChapterRepo = {
      findById: jest.fn(),
      findBySubscriptionId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };

    mockCustomRoleService = {
      findByIds: jest.fn().mockResolvedValue([]),
    };

    mockChapterAuditLogService = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacService,
        { provide: ROLE_REPOSITORY, useValue: mockRoleRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: CHAPTER_REPOSITORY, useValue: mockChapterRepo },
        { provide: CustomRoleService, useValue: mockCustomRoleService },
        {
          provide: ChapterAuditLogService,
          useValue: mockChapterAuditLogService,
        },
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
      system_key: null,
    });
    expect(result).toEqual(role);
  });

  // Only the seeded President role may carry `*`; minting a new wildcard role
  // would bypass the presidency-transfer safeguard (spec/behavior/rbac.md).
  it('rejects creating a role with the wildcard permission', async () => {
    await expect(
      service.create('ch-1', {
        name: 'Shadow President',
        permissions: ['*', 'members:view'],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(mockRoleRepo.create).not.toHaveBeenCalled();
  });

  it('rejects introducing the wildcard on update, but keeps an existing one editable', async () => {
    const plainRole: Role = {
      id: 'role-plain',
      chapter_id: 'ch-1',
      name: 'Plain',
      permissions: ['members:view'],
      is_system: false,
      display_order: 5,
      color: null,
      created_at: '2024-01-01',
    };
    mockRoleRepo.findById.mockResolvedValue(plainRole);

    await expect(
      service.update('role-plain', 'ch-1', { permissions: ['*'] }),
    ).rejects.toThrow(BadRequestException);
    expect(mockRoleRepo.update).not.toHaveBeenCalled();

    // The President role already carries `*` — re-sending it is not an
    // introduction and must stay allowed so its permissions remain editable.
    const presidentRole: Role = {
      ...plainRole,
      id: 'role-president',
      name: 'President',
      permissions: ['*'],
      is_system: true,
    };
    mockRoleRepo.findById.mockResolvedValue(presidentRole);
    mockRoleRepo.update.mockResolvedValue(presidentRole);

    await service.update('role-president', 'ch-1', {
      permissions: ['*'],
    });
    expect(mockRoleRepo.update).toHaveBeenCalledWith('role-president', {
      permissions: ['*'],
    });
  });

  it('rejects stripping the wildcard from the President role, but allows it on a legacy role', async () => {
    // With introduction blocked, a strip would be unrecoverable and leave the
    // chapter without any wildcard holder.
    const presidentRole: Role = {
      id: 'role-president',
      chapter_id: 'ch-1',
      name: 'President',
      permissions: ['*'],
      is_system: true,
      display_order: 1,
      color: null,
      created_at: '2024-01-01',
    };
    mockRoleRepo.findById.mockResolvedValue(presidentRole);

    await expect(
      service.update('role-president', 'ch-1', {
        permissions: ['events:create'],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(mockRoleRepo.update).not.toHaveBeenCalled();

    // A legacy non-system role carrying a pre-validation `*` must stay
    // strippable — that is its cleanup path.
    const legacyRole: Role = {
      ...presidentRole,
      id: 'role-legacy',
      name: 'Legacy Star',
      is_system: false,
    };
    mockRoleRepo.findById.mockResolvedValue(legacyRole);
    mockRoleRepo.update.mockResolvedValue({
      ...legacyRole,
      permissions: ['members:view'],
    });

    await service.update('role-legacy', 'ch-1', {
      permissions: ['members:view'],
    });
    expect(mockRoleRepo.update).toHaveBeenCalledWith('role-legacy', {
      permissions: ['members:view'],
    });
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

    it('throws BadRequest when the current member is in a different chapter', async () => {
      const currentMember = makeMember({
        id: 'member-1',
        user_id: 'user-1',
        chapter_id: 'ch-2',
        role_ids: [presidentRole.id],
      });
      const targetMember = makeMember({
        id: 'member-2',
        user_id: 'user-2',
      });
      mockMemberRepo.findById.mockImplementation((id) =>
        Promise.resolve(
          id === 'member-1'
            ? currentMember
            : id === 'member-2'
              ? targetMember
              : null,
        ),
      );

      await expect(
        service.transferPresidency('ch-1', 'member-1', 'member-2'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.transferPresidency('ch-1', 'member-1', 'member-2'),
      ).rejects.toThrow('Current member is not in this chapter');
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

  // #349: the orphan-president recovery flow (spec/behavior/rbac.md §
  // Presidency Transfer "Edge case").
  describe('orphan-president flow', () => {
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
    const treasurerRole: Role = {
      id: 'role-treasurer',
      chapter_id: 'ch-1',
      name: 'Treasurer',
      permissions: [SystemPermissions.BILLING_MANAGE],
      is_system: true,
      display_order: 2,
      color: null,
      created_at: '2024-01-01',
    };
    const secretaryRole: Role = {
      id: 'role-secretary',
      chapter_id: 'ch-1',
      name: 'Secretary',
      permissions: [SystemPermissions.MEMBERS_VIEW],
      is_system: true,
      display_order: 4,
      color: null,
      created_at: '2024-01-01',
    };
    // The eligibility floor: any role ranked at or below this is the
    // ordinary-member baseline, not an admin tier, and is never eligible to
    // claim — see the "does not let an ordinary Member claim" test below.
    const memberRole: Role = {
      id: 'role-member',
      chapter_id: 'ch-1',
      name: 'Member',
      system_key: SystemRoleKeys.MEMBER,
      permissions: [SystemPermissions.MEMBERS_VIEW],
      is_system: true,
      display_order: 5,
      color: null,
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

    const makeChapter = (overrides: Partial<Chapter>): Chapter => ({
      id: 'ch-1',
      name: 'Test Chapter',
      university: 'Test U',
      stripe_customer_id: null,
      subscription_status: 'active',
      subscription_id: null,
      past_due_since: null,
      last_stripe_webhook_at: null,
      accent_color: null,
      logo_path: null,
      donation_url: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      needs_president: false,
      ...overrides,
    });

    describe('flagIfPresidentRemoved', () => {
      it('is a no-op when the removed member held no roles at all', async () => {
        await service.flagIfPresidentRemoved('ch-1', [], 'actor-1');

        expect(mockRoleRepo.findByChapter).not.toHaveBeenCalled();
        expect(mockChapterRepo.update).not.toHaveBeenCalled();
      });

      it('is a no-op when the removed member did not hold the President role', async () => {
        mockRoleRepo.findByChapter.mockResolvedValue([
          presidentRole,
          treasurerRole,
        ]);

        await service.flagIfPresidentRemoved(
          'ch-1',
          [treasurerRole.id],
          'actor-1',
        );

        expect(mockChapterRepo.update).not.toHaveBeenCalled();
        expect(mockChapterAuditLogService.record).not.toHaveBeenCalled();
      });

      it('is a no-op when the chapter has no President role', async () => {
        mockRoleRepo.findByChapter.mockResolvedValue([treasurerRole]);

        await service.flagIfPresidentRemoved(
          'ch-1',
          [presidentRole.id],
          'actor-1',
        );

        expect(mockChapterRepo.update).not.toHaveBeenCalled();
      });

      it('flags the chapter and audit-logs when the removed member held the President role', async () => {
        mockRoleRepo.findByChapter.mockResolvedValue([
          presidentRole,
          treasurerRole,
        ]);

        await service.flagIfPresidentRemoved(
          'ch-1',
          [presidentRole.id],
          'actor-1',
        );

        expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
          needs_president: true,
        });
        expect(mockChapterAuditLogService.record).toHaveBeenCalledWith({
          chapterId: 'ch-1',
          actorUserId: 'actor-1',
          action: 'president_orphaned',
          targetType: 'chapter',
          targetId: 'ch-1',
          diff: {},
        });
      });

      it('accepts a null actorUserId for the account-deletion path', async () => {
        mockRoleRepo.findByChapter.mockResolvedValue([presidentRole]);

        await service.flagIfPresidentRemoved('ch-1', [presidentRole.id], null);

        expect(mockChapterAuditLogService.record).toHaveBeenCalledWith(
          expect.objectContaining({ actorUserId: null }),
        );
      });
    });

    describe('getPresidencyClaimStatus', () => {
      it('throws NotFound when the chapter does not exist', async () => {
        mockChapterRepo.findById.mockResolvedValue(null);

        await expect(
          service.getPresidencyClaimStatus('ch-1', 'member-1'),
        ).rejects.toThrow(NotFoundException);
      });

      it('short-circuits when the chapter does not need a new President', async () => {
        mockChapterRepo.findById.mockResolvedValue(
          makeChapter({ needs_president: false }),
        );

        const result = await service.getPresidencyClaimStatus(
          'ch-1',
          'member-1',
        );

        expect(result).toEqual({
          needs_president: false,
          eligible: false,
          next_role_name: null,
        });
        expect(mockRoleRepo.findByChapter).not.toHaveBeenCalled();
      });

      it('reports eligible for a member holding the highest-ranked remaining role', async () => {
        mockChapterRepo.findById.mockResolvedValue(
          makeChapter({ needs_president: true }),
        );
        mockRoleRepo.findByChapter.mockResolvedValue([
          presidentRole,
          treasurerRole,
          secretaryRole,
          memberRole,
        ]);
        mockMemberRepo.findByChapter.mockResolvedValue([
          makeMember({ id: 'member-1', role_ids: [treasurerRole.id] }),
          makeMember({ id: 'member-2', role_ids: [secretaryRole.id] }),
        ]);

        const result = await service.getPresidencyClaimStatus(
          'ch-1',
          'member-1',
        );

        expect(result).toEqual({
          needs_president: true,
          eligible: true,
          next_role_name: 'Treasurer',
        });
      });

      it('reports ineligible (with the eligible role name) for a member holding a lower-ranked role', async () => {
        mockChapterRepo.findById.mockResolvedValue(
          makeChapter({ needs_president: true }),
        );
        mockRoleRepo.findByChapter.mockResolvedValue([
          presidentRole,
          treasurerRole,
          secretaryRole,
          memberRole,
        ]);
        mockMemberRepo.findByChapter.mockResolvedValue([
          makeMember({ id: 'member-1', role_ids: [treasurerRole.id] }),
          makeMember({ id: 'member-2', role_ids: [secretaryRole.id] }),
        ]);

        const result = await service.getPresidencyClaimStatus(
          'ch-1',
          'member-2',
        );

        expect(result).toEqual({
          needs_president: true,
          eligible: false,
          next_role_name: 'Treasurer',
        });
      });

      it('reports no eligible role when nobody holds any admin-tier role — the support-fallback case', async () => {
        mockChapterRepo.findById.mockResolvedValue(
          makeChapter({ needs_president: true }),
        );
        mockRoleRepo.findByChapter.mockResolvedValue([
          presidentRole,
          treasurerRole,
          memberRole,
        ]);
        mockMemberRepo.findByChapter.mockResolvedValue([]);

        const result = await service.getPresidencyClaimStatus(
          'ch-1',
          'member-1',
        );

        expect(result).toEqual({
          needs_president: true,
          eligible: false,
          next_role_name: null,
        });
      });

      // #349 hunk-scan finding: without a floor, the eligibility walk fell
      // through vacant officer roles all the way to the ordinary "Member"
      // role — any of its (typically many) holders could then claim the
      // wildcard. The floor at the chapter's own Member role's display_order
      // must hold even when every officer seat is empty but rank-and-file
      // members exist.
      it('does not fall through to the ordinary Member role when every officer seat is vacant', async () => {
        mockChapterRepo.findById.mockResolvedValue(
          makeChapter({ needs_president: true }),
        );
        mockRoleRepo.findByChapter.mockResolvedValue([
          presidentRole,
          treasurerRole,
          secretaryRole,
          memberRole,
        ]);
        // Nobody holds Treasurer or Secretary, but plenty of ordinary members
        // hold the ordinary Member role.
        mockMemberRepo.findByChapter.mockResolvedValue([
          makeMember({ id: 'member-1', role_ids: [memberRole.id] }),
          makeMember({ id: 'member-2', role_ids: [memberRole.id] }),
        ]);

        const result = await service.getPresidencyClaimStatus(
          'ch-1',
          'member-1',
        );

        expect(result).toEqual({
          needs_president: true,
          eligible: false,
          next_role_name: null,
        });
      });

      it('fails closed (nobody eligible) when the chapter has no resolvable Member role', async () => {
        // The legacy system_key backfill gap (spec/behavior/rbac.md): a
        // chapter that renamed its Member role before the backfill has no
        // key on it, so the floor cannot be established. Since this decision
        // grants `*`, the safe direction is "nobody eligible", not "no
        // floor".
        mockChapterRepo.findById.mockResolvedValue(
          makeChapter({ needs_president: true }),
        );
        mockRoleRepo.findByChapter.mockResolvedValue([
          presidentRole,
          treasurerRole,
        ]);
        mockMemberRepo.findByChapter.mockResolvedValue([
          makeMember({ id: 'member-1', role_ids: [treasurerRole.id] }),
        ]);

        const result = await service.getPresidencyClaimStatus(
          'ch-1',
          'member-1',
        );

        expect(result).toEqual({
          needs_president: true,
          eligible: false,
          next_role_name: null,
        });
        expect(mockMemberRepo.findByChapter).not.toHaveBeenCalled();
      });
    });

    describe('claimPresidency', () => {
      it('throws NotFound when the chapter does not exist', async () => {
        mockChapterRepo.findById.mockResolvedValue(null);

        await expect(
          service.claimPresidency('ch-1', 'member-1'),
        ).rejects.toThrow(NotFoundException);
        expect(mockMemberRepo.claimPresidencyAtomic).not.toHaveBeenCalled();
      });

      it('throws BadRequest when the chapter does not need a new President', async () => {
        mockChapterRepo.findById.mockResolvedValue(
          makeChapter({ needs_president: false }),
        );

        await expect(
          service.claimPresidency('ch-1', 'member-1'),
        ).rejects.toThrow(BadRequestException);
        expect(mockMemberRepo.claimPresidencyAtomic).not.toHaveBeenCalled();
      });

      it('throws NotFound when the claiming member does not exist or is in another chapter', async () => {
        mockChapterRepo.findById.mockResolvedValue(
          makeChapter({ needs_president: true }),
        );
        mockMemberRepo.findById.mockResolvedValue(null);

        await expect(
          service.claimPresidency('ch-1', 'member-1'),
        ).rejects.toThrow(NotFoundException);
      });

      it('throws Forbidden when the claiming member does not hold the eligible role', async () => {
        mockChapterRepo.findById.mockResolvedValue(
          makeChapter({ needs_president: true }),
        );
        mockMemberRepo.findById.mockResolvedValue(
          makeMember({ id: 'member-2', role_ids: [secretaryRole.id] }),
        );
        mockRoleRepo.findByChapter.mockResolvedValue([
          presidentRole,
          treasurerRole,
          secretaryRole,
          memberRole,
        ]);
        mockMemberRepo.findByChapter.mockResolvedValue([
          makeMember({ id: 'member-1', role_ids: [treasurerRole.id] }),
          makeMember({ id: 'member-2', role_ids: [secretaryRole.id] }),
        ]);

        await expect(
          service.claimPresidency('ch-1', 'member-2'),
        ).rejects.toThrow(ForbiddenException);
        expect(mockMemberRepo.claimPresidencyAtomic).not.toHaveBeenCalled();
      });

      it('throws Forbidden when no eligible role exists at all (support-fallback case)', async () => {
        mockChapterRepo.findById.mockResolvedValue(
          makeChapter({ needs_president: true }),
        );
        mockMemberRepo.findById.mockResolvedValue(
          makeMember({ id: 'member-1', role_ids: [] }),
        );
        mockRoleRepo.findByChapter.mockResolvedValue([presidentRole]);
        mockMemberRepo.findByChapter.mockResolvedValue([]);

        await expect(
          service.claimPresidency('ch-1', 'member-1'),
        ).rejects.toThrow(ForbiddenException);
        expect(mockMemberRepo.claimPresidencyAtomic).not.toHaveBeenCalled();
      });

      it('claims atomically and audit-logs on success', async () => {
        mockChapterRepo.findById.mockResolvedValue(
          makeChapter({ needs_president: true }),
        );
        mockMemberRepo.findById.mockResolvedValue(
          makeMember({
            id: 'member-1',
            user_id: 'user-1',
            role_ids: [treasurerRole.id],
          }),
        );
        mockRoleRepo.findByChapter.mockResolvedValue([
          presidentRole,
          treasurerRole,
          memberRole,
        ]);
        mockMemberRepo.findByChapter.mockResolvedValue([
          makeMember({
            id: 'member-1',
            user_id: 'user-1',
            role_ids: [treasurerRole.id],
          }),
        ]);
        mockMemberRepo.claimPresidencyAtomic.mockResolvedValue(true);

        await service.claimPresidency('ch-1', 'member-1');

        // Third argument is the role that made the claimant eligible
        // (re-verified atomically by the RPC, not just the President role
        // being granted) — see the claim_presidency migration.
        expect(mockMemberRepo.claimPresidencyAtomic).toHaveBeenCalledWith(
          'ch-1',
          'member-1',
          treasurerRole.id,
          presidentRole.id,
        );
        expect(mockChapterAuditLogService.record).toHaveBeenCalledWith({
          chapterId: 'ch-1',
          actorUserId: 'user-1',
          action: 'presidency_claimed',
          targetType: 'chapter',
          targetId: 'ch-1',
          diff: { claimed_by_member_id: 'member-1' },
        });
      });

      it('maps a false RPC result (race lost) to Conflict', async () => {
        mockChapterRepo.findById.mockResolvedValue(
          makeChapter({ needs_president: true }),
        );
        mockMemberRepo.findById.mockResolvedValue(
          makeMember({ id: 'member-1', role_ids: [treasurerRole.id] }),
        );
        mockRoleRepo.findByChapter.mockResolvedValue([
          presidentRole,
          treasurerRole,
          memberRole,
        ]);
        mockMemberRepo.findByChapter.mockResolvedValue([
          makeMember({ id: 'member-1', role_ids: [treasurerRole.id] }),
        ]);
        mockMemberRepo.claimPresidencyAtomic.mockResolvedValue(false);

        await expect(
          service.claimPresidency('ch-1', 'member-1'),
        ).rejects.toThrow(ConflictException);
        expect(mockChapterAuditLogService.record).not.toHaveBeenCalled();
      });

      it('throws NotFound when the chapter has no President role', async () => {
        mockChapterRepo.findById.mockResolvedValue(
          makeChapter({ needs_president: true }),
        );
        mockMemberRepo.findById.mockResolvedValue(
          makeMember({ id: 'member-1', role_ids: [] }),
        );
        mockRoleRepo.findByChapter.mockResolvedValue([]);

        await expect(
          service.claimPresidency('ch-1', 'member-1'),
        ).rejects.toThrow('President role not found');
        expect(mockMemberRepo.claimPresidencyAtomic).not.toHaveBeenCalled();
      });
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
      system_key: SystemRoleKeys.ALUMNI,
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
      mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue(alumniRole);

      await expect(service.isAlumni('ch-1', 'user-1')).resolves.toBe(true);
      expect(mockRoleRepo.findByChapterAndSystemKey).toHaveBeenCalledWith(
        'ch-1',
        SystemRoleKeys.ALUMNI,
      );
    });

    it('returns false for an active member holding other roles', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(
        memberWithRoles(['role-member']),
      );
      mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue(alumniRole);

      await expect(service.isAlumni('ch-1', 'user-1')).resolves.toBe(false);
    });

    it('returns false when the caller is not a member of the chapter', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(service.isAlumni('ch-1', 'user-1')).resolves.toBe(false);
      // No role lookup needed when there is no membership.
      expect(mockRoleRepo.findByChapterAndSystemKey).not.toHaveBeenCalled();
    });

    it('fails open to normal permissions when the chapter has no Alumni role', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(
        memberWithRoles(['role-alumni']),
      );
      mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue(null);

      await expect(service.isAlumni('ch-1', 'user-1')).resolves.toBe(false);
    });

    it('hasAlumniRole resolves from caller-supplied role ids without a member lookup', async () => {
      mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue(alumniRole);

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
      expect(mockRoleRepo.findByChapterAndSystemKey).not.toHaveBeenCalled();
    });
  });

  // FRA-320. Before `system_key`, every one of these resolved the Alumni role
  // by the literal name "Alumni", so a President renaming it silently switched
  // off study-hour, check-in, and chat restrictions chapter-wide — and
  // reattaching the freed name to another role moved those restrictions onto
  // its holders instead.
  describe('system roles are rename-proof (FRA-320)', () => {
    const renamedAlumniRole: Role = {
      id: 'role-alumni',
      chapter_id: 'ch-1',
      // Renamed by the chapter. Only the label changed.
      name: 'Alumni (Inactive)',
      system_key: SystemRoleKeys.ALUMNI,
      permissions: [SystemPermissions.MEMBERS_VIEW],
      is_system: true,
      display_order: 7,
      color: '#6B7280',
      created_at: '2024-01-01',
    };

    const alumniMember: Member = {
      id: 'member-1',
      user_id: 'user-1',
      chapter_id: 'ch-1',
      role_ids: ['role-alumni'],
      custom_role_ids: [],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };

    it('still applies Alumni restrictions after the role is renamed', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(alumniMember);
      mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue(
        renamedAlumniRole,
      );

      await expect(service.isAlumni('ch-1', 'user-1')).resolves.toBe(true);
      // Resolved by key, never by the (now different) display name.
      expect(mockRoleRepo.findByChapterAndSystemKey).toHaveBeenCalledWith(
        'ch-1',
        SystemRoleKeys.ALUMNI,
      );
      expect(mockRoleRepo.findByChapterAndName).not.toHaveBeenCalled();
    });

    it('does not transfer Alumni restrictions to a role that takes the freed name', async () => {
      // The chapter renamed Alumni, then created a custom role called
      // "Alumni". The custom role carries no system_key, so the lookup still
      // resolves the real one and its holders are unaffected.
      mockMemberRepo.findByUserAndChapter.mockResolvedValue({
        ...alumniMember,
        role_ids: ['role-impostor'],
      });
      mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue(
        renamedAlumniRole,
      );

      await expect(service.isAlumni('ch-1', 'user-1')).resolves.toBe(false);
    });

    it('refuses to set system_key when creating a custom role', async () => {
      mockRoleRepo.findByChapterAndName.mockResolvedValue(null);
      mockRoleRepo.create.mockResolvedValue({});

      await service.create('ch-1', {
        name: 'Impostor',
        permissions: ['members:view'],
        // A caller trying to mint a role that impersonates the seeded Alumni.
        system_key: SystemRoleKeys.ALUMNI,
      });

      expect(mockRoleRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ system_key: null }),
      );
    });

    it('strips system_key from role updates', async () => {
      const role: Role = { ...renamedAlumniRole, name: 'Alumni' };
      mockRoleRepo.findById.mockResolvedValue(role);
      mockRoleRepo.findByChapterAndName.mockResolvedValue(null);
      mockRoleRepo.update.mockResolvedValue(role);

      await service.update('role-alumni', 'ch-1', {
        name: 'Graduated',
        // Attempting to detach the key — the rename hole by another route.
        system_key: null,
      });

      const [, updatePayload] = mockRoleRepo.update.mock.calls[0];
      expect(updatePayload).not.toHaveProperty('system_key');
      expect(updatePayload.name).toBe('Graduated');
    });
  });
});
