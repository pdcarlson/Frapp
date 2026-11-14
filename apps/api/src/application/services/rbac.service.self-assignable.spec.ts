import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { RbacService } from './rbac.service';
import { ChapterAuditLogService } from './chapter-audit-log.service';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import { ROLE_TIER_REPOSITORY } from '#domain/repositories/role-tier.repository.interface';
import type { Role, RoleTier } from '#domain/entities/role.entity';
import { effectivePermissions } from '#domain/utils/role-rank';
import { createAuditLogServiceMock } from '#test/helpers/audit-log.mock';
import { createChapterGroupRepoMock } from '#test/helpers/chapter-group-repo.mock';
import { CHAPTER_GROUP_REPOSITORY } from '#domain/repositories/chapter-group.repository.interface';
import {
  CHAPTER_ID,
  ROLE,
  TIER,
  USER,
  tieredChapterMembers,
  tieredChapterRoles,
  tieredChapterTiers,
} from '#test/helpers/tiered-chapter.fixture';

const INTRAMURALS = 'role-intramurals';
const BRAND_NEW = 'role-brand-new';

/**
 * Self-assignable roles (#4958): an officer marks a role members join and
 * leave themselves, and nobody may pick their way into power. Walked on the
 * tiered fixture chapter (President, exec, chairs, brothers, associates) with
 * one interest role outside the tiers.
 */
describe('RbacService self-assignable roles (#4958)', () => {
  let service: RbacService;
  let roles: Role[];
  let tiers: RoleTier[];
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
  const memberRepo = {
    findByUserAndChapter: jest.fn(),
    setSelfAssignedRole: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const base = tieredChapterRoles();
    const interest = (id: string, name: string, marked: boolean): Role => ({
      ...base.find((r) => r.id === ROLE.brother)!,
      id,
      name,
      tier_id: null,
      permissions: [],
      permission_overrides: {},
      self_assignable: marked,
    });
    roles = [
      ...base,
      interest(INTRAMURALS, 'Intramurals', true),
      interest(BRAND_NEW, 'Study group', false),
    ];
    tiers = tieredChapterTiers();
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
    roleRepo.delete.mockResolvedValue({
      strippedMemberIds: [],
      givenEveryoneMemberIds: [],
    });
    memberRepo.setSelfAssignedRole.mockImplementation(
      async (_c: string, memberId: string, roleId: string, join: boolean) => {
        const held = members.find((m) => m.id === memberId)!.role_ids;
        return {
          outcome: 'ok',
          role_ids: join
            ? [...held.filter((id) => id !== roleId), roleId]
            : held.filter((id) => id !== roleId),
        };
      },
    );
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
        {
          provide: CHAPTER_GROUP_REPOSITORY,
          useValue: createChapterGroupRepoMock(),
        },
      ],
    }).compile();
    service = module.get(RbacService);
  });

  const roleById = (id: string) => roles.find((r) => r.id === id)!;
  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      const response = (
        error as { getResponse?: () => unknown }
      ).getResponse?.() as { code?: string } | undefined;
      return { type: error?.constructor, code: response?.code };
    }
    return { type: undefined, code: undefined };
  };

  describe('marking a role (PATCH /v1/roles/:id self_assignable)', () => {
    it('marks a role outside the tiers that holds nothing', async () => {
      const saved = await service.updateAsMember(
        BRAND_NEW,
        CHAPTER_ID,
        USER.riskChair,
        { self_assignable: true },
      );
      expect(roleRepo.update).toHaveBeenCalledWith(BRAND_NEW, {
        self_assignable: true,
      });
      expect(saved.self_assignable).toBe(true);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'role_updated',
          diff: { self_assignable: { from: false, to: true } },
        }),
      );
    });

    it('refuses a keyed role (President, Everyone, New Member, Alumni)', async () => {
      for (const key of ['PRESIDENT', 'MEMBER', 'NEW_MEMBER', 'ALUMNI']) {
        roleById(BRAND_NEW).system_key = key;
        expect(
          await codeOf(
            service.updateAsMember(BRAND_NEW, CHAPTER_ID, USER.president, {
              self_assignable: true,
            }),
          ),
        ).toEqual({
          type: BadRequestException,
          code: 'role.self_assignable_keyed',
        });
      }
      expect(roleRepo.update).not.toHaveBeenCalled();
    });

    it('refuses a role in a tier, even the lowest, since a tier is rank', async () => {
      expect(
        await codeOf(
          service.updateAsMember(ROLE.pledge, CHAPTER_ID, USER.president, {
            self_assignable: true,
          }),
        ),
      ).toEqual({
        type: BadRequestException,
        code: 'role.self_assignable_tiered',
      });
      expect(roleRepo.update).not.toHaveBeenCalled();
    });

    it('refuses a role holding a permission beyond channels:read', async () => {
      // Alumni sits outside the tiers in the fixture but holds members:view.
      expect(
        await codeOf(
          service.updateAsMember(ROLE.alumni, CHAPTER_ID, USER.president, {
            self_assignable: true,
          }),
        ),
      ).toEqual({
        type: BadRequestException,
        code: 'role.self_assignable_permissions',
      });
    });

    it('refuses marking and granting in one save', async () => {
      expect(
        await codeOf(
          service.updateAsMember(BRAND_NEW, CHAPTER_ID, USER.president, {
            self_assignable: true,
            permissions: ['events:create'],
          }),
        ),
      ).toEqual({
        type: BadRequestException,
        code: 'role.self_assignable_permissions',
      });
    });

    it('refuses marking and moving into a tier in one save', async () => {
      expect(
        await codeOf(
          service.updateAsMember(BRAND_NEW, CHAPTER_ID, USER.president, {
            self_assignable: true,
            tier_id: TIER.pledges,
          }),
        ),
      ).toEqual({
        type: BadRequestException,
        code: 'role.self_assignable_tiered',
      });
    });

    it('allows channels:read keys, but only to a caller who holds them', async () => {
      roleById(BRAND_NEW).permissions = ['channels:read:study'];
      await expect(
        service.updateAsMember(BRAND_NEW, CHAPTER_ID, USER.riskChair, {
          self_assignable: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(roleRepo.update).not.toHaveBeenCalled();

      await service.updateAsMember(BRAND_NEW, CHAPTER_ID, USER.president, {
        self_assignable: true,
      });
      expect(roleRepo.update).toHaveBeenCalledWith(BRAND_NEW, {
        self_assignable: true,
      });
    });
  });

  describe('editing a role members already pick', () => {
    it('refuses granting it a permission unless the save also unmarks it', async () => {
      expect(
        await codeOf(
          service.updateAsMember(INTRAMURALS, CHAPTER_ID, USER.president, {
            permissions: ['events:create'],
          }),
        ),
      ).toEqual({
        type: BadRequestException,
        code: 'role.self_assignable_permissions',
      });
      expect(roleRepo.update).not.toHaveBeenCalled();

      await service.updateAsMember(INTRAMURALS, CHAPTER_ID, USER.president, {
        permissions: ['events:create'],
        self_assignable: false,
      });
      expect(roleRepo.update).toHaveBeenCalledWith(INTRAMURALS, {
        permissions: ['events:create'],
        self_assignable: false,
      });
    });

    it('refuses switching an override on', async () => {
      expect(
        await codeOf(
          service.updateAsMember(INTRAMURALS, CHAPTER_ID, USER.president, {
            permission_overrides: { 'events:create': true },
          }),
        ),
      ).toEqual({
        type: BadRequestException,
        code: 'role.self_assignable_permissions',
      });
    });

    it('refuses moving it into a tier', async () => {
      expect(
        await codeOf(
          service.updateAsMember(INTRAMURALS, CHAPTER_ID, USER.president, {
            tier_id: TIER.pledges,
          }),
        ),
      ).toEqual({
        type: BadRequestException,
        code: 'role.self_assignable_tiered',
      });
    });

    it('lets a rename or recolor through', async () => {
      await service.updateAsMember(INTRAMURALS, CHAPTER_ID, USER.riskChair, {
        name: 'IM sports',
      });
      expect(roleRepo.update).toHaveBeenCalledWith(INTRAMURALS, {
        name: 'IM sports',
      });
    });
  });

  describe('joining and leaving (POST /v1/roles/:id/join and /leave)', () => {
    it('a brother joins a marked role through self_assign_role', async () => {
      const result = await service.setOwnSelfAssignableRole(
        CHAPTER_ID,
        USER.brother,
        INTRAMURALS,
        true,
      );
      expect(memberRepo.setSelfAssignedRole).toHaveBeenCalledWith(
        CHAPTER_ID,
        'member-brother',
        INTRAMURALS,
        true,
      );
      expect(result).toEqual({ role_ids: [ROLE.brother, INTRAMURALS] });
    });

    it('and leaves it', async () => {
      await service.setOwnSelfAssignableRole(
        CHAPTER_ID,
        USER.brother,
        INTRAMURALS,
        false,
      );
      expect(memberRepo.setSelfAssignedRole).toHaveBeenCalledWith(
        CHAPTER_ID,
        'member-brother',
        INTRAMURALS,
        false,
      );
    });

    it.each([
      ['an unmarked role', BRAND_NEW],
      ["an officer's role", ROLE.vicePresident],
      ["the President's role", ROLE.president],
      ['a pledge role in a tier', ROLE.pledge],
    ])('refuses %s, joining or leaving', async (_label, roleId) => {
      for (const join of [true, false]) {
        expect(
          await codeOf(
            service.setOwnSelfAssignableRole(
              CHAPTER_ID,
              USER.brother,
              roleId,
              join,
            ),
          ),
        ).toEqual({
          type: ForbiddenException,
          code: 'role.not_self_assignable',
        });
      }
      expect(memberRepo.setSelfAssignedRole).not.toHaveBeenCalled();
    });

    it('refuses a role whose flag is stale: marked but no longer safe', async () => {
      // A row the database would have cleared; the API re-checks anyway.
      Object.assign(roleById(INTRAMURALS), {
        permissions: ['roles:manage'],
      });
      expect(
        await codeOf(
          service.setOwnSelfAssignableRole(
            CHAPTER_ID,
            USER.brother,
            INTRAMURALS,
            true,
          ),
        ),
      ).toEqual({
        type: ForbiddenException,
        code: 'role.not_self_assignable',
      });
      Object.assign(roleById(INTRAMURALS), {
        permissions: [],
        system_key: 'PRESIDENT',
      });
      await expect(
        service.setOwnSelfAssignableRole(
          CHAPTER_ID,
          USER.brother,
          INTRAMURALS,
          true,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(memberRepo.setSelfAssignedRole).not.toHaveBeenCalled();
    });

    it("refuses another chapter's role", async () => {
      roleById(INTRAMURALS).chapter_id = 'chapter-other';
      await expect(
        service.setOwnSelfAssignableRole(
          CHAPTER_ID,
          USER.brother,
          INTRAMURALS,
          true,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(memberRepo.setSelfAssignedRole).not.toHaveBeenCalled();
    });

    it('answers 404 for a role that does not exist', async () => {
      await expect(
        service.setOwnSelfAssignableRole(
          CHAPTER_ID,
          USER.brother,
          'role-missing',
          true,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('answers 409 when the role changed under the lock', async () => {
      memberRepo.setSelfAssignedRole.mockResolvedValueOnce({
        outcome: 'not_assignable',
        role_ids: null,
      });
      await expect(
        service.setOwnSelfAssignableRole(
          CHAPTER_ID,
          USER.brother,
          INTRAMURALS,
          true,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('answers 404 for a caller with no membership', async () => {
      await expect(
        service.setOwnSelfAssignableRole(
          CHAPTER_ID,
          'user-nobody',
          INTRAMURALS,
          true,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
