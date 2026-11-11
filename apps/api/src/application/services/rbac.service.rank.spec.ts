import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RbacService } from './rbac.service';
import { ChapterAuditLogService } from './chapter-audit-log.service';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import { ROLE_TIER_REPOSITORY } from '#domain/repositories/role-tier.repository.interface';
import type { Role } from '#domain/entities/role.entity';
import { effectivePermissions } from '#domain/utils/role-rank';
import { createAuditLogServiceMock } from '#test/helpers/audit-log.mock';
import {
  CHAPTER_ID,
  ROLE,
  TIER,
  USER,
  tieredChapterMembers,
  tieredChapterRoles,
  tieredChapterTiers,
} from '#test/helpers/tiered-chapter.fixture';

/**
 * The rank rules on `POST`, `PATCH` and `DELETE /v1/roles` (#4071), walked as
 * a chapter with a President, exec officers, a dozen chairs and brothers. The
 * case they exist for: a chair holding `roles:manage` must not be able to
 * promote themselves.
 */
describe('RbacService rank rules (#4071)', () => {
  let service: RbacService;
  let roles: Role[];
  let audit: ReturnType<typeof createAuditLogServiceMock>;
  const roleRepo = {
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
  const memberRepo = { findByUserAndChapter: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    roles = tieredChapterRoles();
    const tiers = tieredChapterTiers();
    const members = tieredChapterMembers();
    roleRepo.findByChapter.mockResolvedValue(roles);
    roleRepo.findById.mockImplementation(
      async (id: string) => roles.find((role) => role.id === id) ?? null,
    );
    roleRepo.findByChapterAndName.mockResolvedValue(null);
    roleRepo.create.mockImplementation(async (data: Partial<Role>) => ({
      ...data,
      id: 'role-new',
    }));
    // What the database's trigger does with the write.
    roleRepo.update.mockImplementation(
      async (id: string, data: Partial<Role>) => {
        const before = roles.find((role) => role.id === id)!;
        const next = { ...before, ...data };
        if (data.permissions === undefined) {
          const tierPermissions =
            tiers.find((tier) => tier.id === next.tier_id)?.permissions ?? [];
          next.permissions = effectivePermissions(
            tierPermissions,
            next.permission_overrides,
          );
        }
        return next;
      },
    );
    roleRepo.delete.mockResolvedValue(undefined);
    memberRepo.findByUserAndChapter.mockImplementation(
      async (userId: string) =>
        members.find((member) => member.user_id === userId) ?? null,
    );
    audit = createAuditLogServiceMock();

    const module = await Test.createTestingModule({
      providers: [
        RbacService,
        { provide: ROLE_REPOSITORY, useValue: roleRepo },
        { provide: MEMBER_REPOSITORY, useValue: memberRepo },
        { provide: CHAPTER_REPOSITORY, useValue: {} },
        {
          provide: ROLE_TIER_REPOSITORY,
          useValue: { findByChapter: jest.fn().mockResolvedValue(tiers) },
        },
        { provide: ChapterAuditLogService, useValue: audit },
      ],
    }).compile();
    service = module.get(RbacService);
  });

  describe('a chair holding roles:manage', () => {
    it('cannot edit their own role, so cannot grant themselves anything', async () => {
      await expect(
        service.updateAsMember(ROLE.riskChair, CHAPTER_ID, USER.riskChair, {
          permissions: [
            ...roles.find((r) => r.id === ROLE.riskChair)!.permissions,
            'chapter-config:manage',
          ],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(roleRepo.update).not.toHaveBeenCalled();
    });

    it('cannot move their own role into the exec tier', async () => {
      await expect(
        service.updateAsMember(ROLE.riskChair, CHAPTER_ID, USER.riskChair, {
          tier_id: TIER.board,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("cannot edit another chair's role, which ranks level with theirs", async () => {
      await expect(
        service.updateAsMember(ROLE.socialChair, CHAPTER_ID, USER.riskChair, {
          name: 'Party chair',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('cannot move a role below them up into their own tier', async () => {
      await expect(
        service.updateAsMember(ROLE.brother, CHAPTER_ID, USER.riskChair, {
          tier_id: TIER.chairs,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('edits a role below them with permissions they hold', async () => {
      const updated = await service.updateAsMember(
        ROLE.brother,
        CHAPTER_ID,
        USER.riskChair,
        { permission_overrides: { 'tasks:manage': true } },
      );
      expect(updated.permissions).toContain('tasks:manage');
      expect(roleRepo.update).toHaveBeenCalledWith(ROLE.brother, {
        permission_overrides: { 'tasks:manage': true },
      });
    });

    it('cannot grant a role below them a permission they lack, by list or by override', async () => {
      await expect(
        service.updateAsMember(ROLE.brother, CHAPTER_ID, USER.riskChair, {
          permissions: ['members:view', 'service:log', 'billing:manage'],
        }),
      ).rejects.toThrow(/billing:manage/);
      await expect(
        service.updateAsMember(ROLE.brother, CHAPTER_ID, USER.riskChair, {
          permission_overrides: { 'billing:manage': true },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('takes permissions away from a role below them, even ones they lack', async () => {
      await service.updateAsMember(
        ROLE.treasuryAssistant,
        CHAPTER_ID,
        USER.riskChair,
        { permission_overrides: { 'billing:view': null } },
      );
      expect(roleRepo.update).toHaveBeenCalledWith(ROLE.treasuryAssistant, {
        permission_overrides: {},
      });
    });

    it('creates roles only below them, holding only what they hold', async () => {
      await expect(
        service.createAsMember(CHAPTER_ID, USER.riskChair, {
          name: 'Philanthropy chair',
          permissions: [],
          tier_id: TIER.chairs,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.createAsMember(CHAPTER_ID, USER.riskChair, {
          name: 'Bookkeeper',
          permissions: ['billing:view'],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await service.createAsMember(CHAPTER_ID, USER.riskChair, {
        name: 'House manager',
        permissions: [],
        tier_id: TIER.brothers,
      });
      expect(roleRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tier_id: TIER.brothers }),
      );
    });

    it('deletes only roles below them', async () => {
      await expect(
        service.deleteAsMember(ROLE.socialChair, CHAPTER_ID, USER.riskChair),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await service.deleteAsMember(ROLE.pledge, CHAPTER_ID, USER.riskChair);
      expect(roleRepo.delete).toHaveBeenCalledWith(ROLE.pledge);
    });
  });

  describe('an exec officer', () => {
    it("cannot edit the President's role or a fellow officer's", async () => {
      for (const roleId of [ROLE.president, ROLE.treasurer]) {
        await expect(
          service.updateAsMember(roleId, CHAPTER_ID, USER.vicePresident, {
            color: null,
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
    });

    it("moves a chair's role between the tiers below them, and records it", async () => {
      await service.updateAsMember(
        ROLE.socialChair,
        CHAPTER_ID,
        USER.vicePresident,
        { tier_id: TIER.brothers },
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'role_updated',
          targetId: ROLE.socialChair,
          diff: expect.objectContaining({
            tier_id: { from: TIER.chairs, to: TIER.brothers },
          }),
        }),
      );
    });

    it('cannot move a role up into their own tier', async () => {
      await expect(
        service.updateAsMember(
          ROLE.socialChair,
          CHAPTER_ID,
          USER.vicePresident,
          { tier_id: TIER.board },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('the President', () => {
    it('edits any role, their own tier included', async () => {
      await service.updateAsMember(
        ROLE.vicePresident,
        CHAPTER_ID,
        USER.president,
        { tier_id: TIER.chairs },
      );
      expect(roleRepo.update).toHaveBeenCalledWith(ROLE.vicePresident, {
        tier_id: TIER.chairs,
      });
    });

    it('still cannot set or clear the wildcard as an override', async () => {
      await expect(
        service.updateAsMember(ROLE.president, CHAPTER_ID, USER.president, {
          permission_overrides: { '*': null },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.updateAsMember(ROLE.vicePresident, CHAPTER_ID, USER.president, {
          permission_overrides: { '*': true },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('refuses a request that sends a list and a tier change together', async () => {
    await expect(
      service.updateAsMember(ROLE.brother, CHAPTER_ID, USER.president, {
        permissions: ['members:view'],
        tier_id: TIER.pledges,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses another chapter's tier and an override that is not a switch", async () => {
    await expect(
      service.updateAsMember(ROLE.brother, CHAPTER_ID, USER.president, {
        tier_id: 'tier-of-another-chapter',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateAsMember(ROLE.brother, CHAPTER_ID, USER.president, {
        permission_overrides: { 'tasks:manage': 'yes' as unknown as boolean },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a member with no role in the chapter', async () => {
    await expect(
      service.updateAsMember(ROLE.pledge, CHAPTER_ID, 'user-stranger', {
        name: 'x',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
