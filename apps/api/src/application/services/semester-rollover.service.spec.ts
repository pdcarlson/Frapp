import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { SemesterRolloverService } from './semester-rollover.service';
import { SEMESTER_ARCHIVE_REPOSITORY } from '../../domain/repositories/semester-archive.repository.interface';
import type { ISemesterArchiveRepository } from '../../domain/repositories/semester-archive.repository.interface';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import type { IRoleRepository } from '../../domain/repositories/role.repository.interface';
import {
  SystemPermissions,
  SystemRoleKeys,
} from '../../domain/constants/permissions';
import { RbacService } from './rbac.service';
import type { Role } from '../../domain/entities/role.entity';
import type { SemesterArchive } from '../../domain/entities/semester-archive.entity';

describe('SemesterRolloverService', () => {
  let service: SemesterRolloverService;
  let mockArchiveRepo: jest.Mocked<ISemesterArchiveRepository>;
  let mockRoleRepo: jest.Mocked<IRoleRepository>;
  let mockRbacService: { getEffectivePermissions: jest.Mock };

  const baseArchive: SemesterArchive = {
    id: 'arch-1',
    chapter_id: 'ch-1',
    label: 'Fall 2025',
    start_date: '2025-08-01',
    end_date: '2025-12-15',
    created_at: '2025-12-16T00:00:00.000Z',
  };

  const newMemberRole = {
    id: 'role-new',
    system_key: SystemRoleKeys.NEW_MEMBER,
  } as Role;
  const memberRole = {
    id: 'role-member',
    system_key: SystemRoleKeys.MEMBER,
  } as Role;

  /** Resolve both system roles, as a healthy seeded chapter would. */
  function withBothSystemRoles() {
    mockRoleRepo.findByChapterAndSystemKey.mockImplementation(
      (_chapterId: string, systemKey: string) =>
        Promise.resolve(
          systemKey === SystemRoleKeys.NEW_MEMBER
            ? newMemberRole
            : systemKey === SystemRoleKeys.MEMBER
              ? memberRole
              : null,
        ),
    );
  }

  beforeEach(async () => {
    mockArchiveRepo = {
      findByChapter: jest.fn(),
      findLatestByChapter: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      createWithPromotion: jest.fn(),
    };

    // Default: the caller can manage roles. Tests that care about the
    // authority check override this explicitly.
    mockRbacService = {
      getEffectivePermissions: jest
        .fn()
        .mockResolvedValue([SystemPermissions.ROLES_MANAGE]),
    };

    mockRoleRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      findByIds: jest.fn(),
      findByChapterAndName: jest.fn(),
      findByChapterAndSystemKey: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SemesterRolloverService,
        {
          provide: SEMESTER_ARCHIVE_REPOSITORY,
          useValue: mockArchiveRepo,
        },
        {
          provide: ROLE_REPOSITORY,
          useValue: mockRoleRepo,
        },
        {
          provide: RbacService,
          useValue: mockRbacService,
        },
      ],
    }).compile();

    service = module.get(SemesterRolloverService);
  });

  describe('rollover', () => {
    it('should create semester archive when no previous archive exists', async () => {
      mockArchiveRepo.findLatestByChapter.mockResolvedValue(null);
      mockArchiveRepo.create.mockResolvedValue(baseArchive);

      const result = await service.rollover({
        chapterId: 'ch-1',
        userId: 'user-1',
        label: 'Fall 2025',
        startDate: '2025-08-01',
        endDate: '2025-12-15',
      });

      expect(result).toEqual(baseArchive);
      expect(mockArchiveRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        label: 'Fall 2025',
        start_date: '2025-08-01',
        end_date: '2025-12-15',
      });
    });

    it('should create semester archive when last rollover was in previous month', async () => {
      // Anchor to the first of the previous month in UTC. Using
      // `new Date().setMonth(m - 1)` overflows on month-end days (e.g. May 31
      // → "April 31" rolls forward to May 1, still the current month), which
      // made this assertion fail on those dates. The service compares months
      // via getUTCMonth(), so construct the fixture the same way.
      const now = new Date();
      const lastMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
      );
      mockArchiveRepo.findLatestByChapter.mockResolvedValue({
        ...baseArchive,
        created_at: lastMonth.toISOString(),
      });
      mockArchiveRepo.create.mockResolvedValue({
        ...baseArchive,
        id: 'arch-2',
        label: 'Spring 2026',
      });

      const result = await service.rollover({
        chapterId: 'ch-1',
        userId: 'user-1',
        label: 'Spring 2026',
        startDate: '2026-01-10',
        endDate: '2026-05-15',
      });

      expect(mockArchiveRepo.create).toHaveBeenCalled();
      expect(result.label).toBe('Spring 2026');
    });

    it('should throw ConflictException when rollover already done this month', async () => {
      const thisMonth = new Date();
      mockArchiveRepo.findLatestByChapter.mockResolvedValue({
        ...baseArchive,
        created_at: thisMonth.toISOString(),
      });

      await expect(
        service.rollover({
          chapterId: 'ch-1',
          userId: 'user-1',
          userId: 'user-1',
          label: 'Spring 2026',
          startDate: '2026-01-10',
          endDate: '2026-05-15',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException when same calendar month', async () => {
      // First of the current month in UTC, matching the service's getUTCMonth()
      // comparison (a local-time construction can land in the prior month for
      // negative-offset zones near a month boundary).
      const now = new Date();
      const sameMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      );
      mockArchiveRepo.findLatestByChapter.mockResolvedValue({
        ...baseArchive,
        created_at: sameMonth.toISOString(),
      });

      await expect(
        service.rollover({
          chapterId: 'ch-1',
          userId: 'user-1',
          userId: 'user-1',
          label: 'Duplicate',
          startDate: '2026-01-01',
          endDate: '2026-01-31',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('listSemesters', () => {
    it('should return archived semesters ordered by end date', async () => {
      mockArchiveRepo.findByChapter.mockResolvedValue([
        baseArchive,
        {
          ...baseArchive,
          id: 'arch-2',
          label: 'Spring 2025',
          start_date: '2025-01-10',
          end_date: '2025-05-15',
        },
      ]);

      const result = await service.listSemesters('ch-1');

      expect(result).toHaveLength(2);
      expect(mockArchiveRepo.findByChapter).toHaveBeenCalledWith('ch-1');
    });

    it('should return empty array when no archives exist', async () => {
      mockArchiveRepo.findByChapter.mockResolvedValue([]);

      const result = await service.listSemesters('ch-1');

      expect(result).toEqual([]);
    });

    it('should return single archive when only one exists', async () => {
      mockArchiveRepo.findByChapter.mockResolvedValue([baseArchive]);

      const result = await service.listSemesters('ch-1');

      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Fall 2025');
    });
  });

  describe('rollover edge cases', () => {
    it('should succeed when last rollover was 2 months ago', async () => {
      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
      mockArchiveRepo.findLatestByChapter.mockResolvedValue({
        ...baseArchive,
        created_at: twoMonthsAgo.toISOString(),
      });
      mockArchiveRepo.create.mockResolvedValue({
        ...baseArchive,
        id: 'arch-2',
        label: 'Spring 2026',
      });

      const result = await service.rollover({
        chapterId: 'ch-1',
        userId: 'user-1',
        label: 'Spring 2026',
        startDate: '2026-01-10',
        endDate: '2026-05-15',
      });

      expect(result.label).toBe('Spring 2026');
      expect(mockArchiveRepo.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('New Member promotion (#285)', () => {
    beforeEach(() => {
      mockArchiveRepo.findLatestByChapter.mockResolvedValue(null);
    });

    const input = {
      chapterId: 'ch-1',
      label: 'Fall 2026',
      startDate: '2026-08-01',
      endDate: '2026-12-15',
    };

    it('does not touch roles when the flag is absent', async () => {
      mockArchiveRepo.create.mockResolvedValue(baseArchive);

      await service.rollover(input);

      // The unpromoted path must stay a single write on the original code path.
      expect(mockArchiveRepo.create).toHaveBeenCalledTimes(1);
      expect(mockArchiveRepo.createWithPromotion).not.toHaveBeenCalled();
      expect(mockRoleRepo.findByChapterAndSystemKey).not.toHaveBeenCalled();
    });

    it('does not touch roles when the flag is explicitly false', async () => {
      mockArchiveRepo.create.mockResolvedValue(baseArchive);

      await service.rollover({ ...input, promoteNewMembers: false });

      expect(mockArchiveRepo.create).toHaveBeenCalledTimes(1);
      expect(mockArchiveRepo.createWithPromotion).not.toHaveBeenCalled();
      expect(mockRoleRepo.findByChapterAndSystemKey).not.toHaveBeenCalled();
    });

    it('promotes through the atomic path when the flag is set', async () => {
      withBothSystemRoles();
      mockArchiveRepo.createWithPromotion.mockResolvedValue(baseArchive);

      const result = await service.rollover({
        ...input,
        promoteNewMembers: true,
      });

      expect(result).toEqual(baseArchive);
      // The archive insert and the role swap must go through the single
      // transactional RPC, never the plain insert plus a second write.
      expect(mockArchiveRepo.create).not.toHaveBeenCalled();
      expect(mockArchiveRepo.createWithPromotion).toHaveBeenCalledWith({
        chapterId: 'ch-1',
        label: 'Fall 2026',
        startDate: '2026-08-01',
        endDate: '2026-12-15',
        newMemberRoleId: 'role-new',
        memberRoleId: 'role-member',
      });
    });

    it('refuses promotion when the caller lacks roles:manage', async () => {
      // Rewriting members.role_ids chapter-wide is what
      // `PATCH /v1/members/:id/roles` gates behind roles:manage. semester:rollover
      // and roles:manage are separable — a chapter can mint a custom role holding
      // only the former — so the promotion door must not be a way around it.
      mockRbacService.getEffectivePermissions.mockResolvedValue([
        SystemPermissions.SEMESTER_ROLLOVER,
      ]);
      withBothSystemRoles();

      await expect(
        service.rollover({ ...input, promoteNewMembers: true }),
      ).rejects.toThrow(ForbiddenException);

      expect(mockArchiveRepo.create).not.toHaveBeenCalled();
      expect(mockArchiveRepo.createWithPromotion).not.toHaveBeenCalled();
    });

    it('lets the wildcard (President) through', async () => {
      // getEffectivePermissions preserves `*` from live roles (it is only
      // stripped from custom-role capabilities), and `can()` honors it — so the
      // check must not lock out the one role that holds every permission.
      mockRbacService.getEffectivePermissions.mockResolvedValue([
        SystemPermissions.WILDCARD,
      ]);
      withBothSystemRoles();
      mockArchiveRepo.createWithPromotion.mockResolvedValue(baseArchive);

      await expect(
        service.rollover({ ...input, promoteNewMembers: true }),
      ).resolves.toEqual(baseArchive);
    });

    it("never asks for the caller's permissions on an unpromoted rollover", async () => {
      mockArchiveRepo.create.mockResolvedValue(baseArchive);

      await service.rollover(input);

      // A plain rollover must not start requiring roles:manage.
      expect(mockRbacService.getEffectivePermissions).not.toHaveBeenCalled();
    });

    it('resolves both roles by system_key, never by name', async () => {
      withBothSystemRoles();
      mockArchiveRepo.createWithPromotion.mockResolvedValue(baseArchive);

      await service.rollover({ ...input, promoteNewMembers: true });

      // A chapter may rename its system roles freely, which is why
      // 20260806220000_role_system_key.sql exists. Keying on `name` here would
      // silently promote nobody for any chapter that relabelled either role.
      expect(mockRoleRepo.findByChapterAndName).not.toHaveBeenCalled();
      expect(mockRoleRepo.findByChapterAndSystemKey).toHaveBeenCalledWith(
        'ch-1',
        SystemRoleKeys.NEW_MEMBER,
      );
      expect(mockRoleRepo.findByChapterAndSystemKey).toHaveBeenCalledWith(
        'ch-1',
        SystemRoleKeys.MEMBER,
      );
    });

    it('refuses, and writes nothing, when the New Member role is missing', async () => {
      mockRoleRepo.findByChapterAndSystemKey.mockImplementation(
        (_chapterId: string, systemKey: string) =>
          Promise.resolve(
            systemKey === SystemRoleKeys.MEMBER ? memberRole : null,
          ),
      );

      await expect(
        service.rollover({ ...input, promoteNewMembers: true }),
      ).rejects.toThrow(ConflictException);

      // Refusing beats archiving with a silent no-op promotion: an officer who
      // ticked the box must not be told the semester rolled over while nobody
      // was promoted. Nothing is written, so the retry is still available.
      expect(mockArchiveRepo.create).not.toHaveBeenCalled();
      expect(mockArchiveRepo.createWithPromotion).not.toHaveBeenCalled();
    });

    it('refuses, and writes nothing, when the Member role is missing', async () => {
      mockRoleRepo.findByChapterAndSystemKey.mockImplementation(
        (_chapterId: string, systemKey: string) =>
          Promise.resolve(
            systemKey === SystemRoleKeys.NEW_MEMBER ? newMemberRole : null,
          ),
      );

      await expect(
        service.rollover({ ...input, promoteNewMembers: true }),
      ).rejects.toThrow(ConflictException);

      expect(mockArchiveRepo.create).not.toHaveBeenCalled();
      expect(mockArchiveRepo.createWithPromotion).not.toHaveBeenCalled();
    });

    it('enforces the monthly limit before resolving roles or promoting', async () => {
      const now = new Date();
      mockArchiveRepo.findLatestByChapter.mockResolvedValue({
        ...baseArchive,
        created_at: new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
        ).toISOString(),
      });
      withBothSystemRoles();

      await expect(
        service.rollover({ ...input, promoteNewMembers: true }),
      ).rejects.toThrow(ConflictException);

      // A blocked rollover must not promote anyone as a side effect.
      expect(mockArchiveRepo.createWithPromotion).not.toHaveBeenCalled();
      expect(mockRoleRepo.findByChapterAndSystemKey).not.toHaveBeenCalled();
    });
  });
});
