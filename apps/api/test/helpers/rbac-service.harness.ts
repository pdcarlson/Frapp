import { Test } from '@nestjs/testing';
import { RbacService } from '../../src/application/services/rbac.service';
import { ChapterAuditLogService } from '../../src/application/services/chapter-audit-log.service';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import { ROLE_TIER_REPOSITORY } from '#domain/repositories/role-tier.repository.interface';
import { CHAPTER_GROUP_REPOSITORY } from '#domain/repositories/chapter-group.repository.interface';
import type { Role, RoleTier } from '#domain/entities/role.entity';
import type { Member } from '#domain/entities/member.entity';
import { effectivePermissions } from '#domain/utils/role-rank';
import {
  createAuditLogServiceMock,
  type AuditLogServiceMock,
} from './audit-log.mock';
import { createChapterGroupRepoMock } from './chapter-group-repo.mock';
import {
  tieredChapterMembers,
  tieredChapterRoles,
  tieredChapterTiers,
} from './tiered-chapter.fixture';

/** The role repository methods `RbacService` reaches, each a jest mock. */
export type TieredRoleRepoMock = {
  findById: jest.Mock;
  findByChapter: jest.Mock;
  findByIds: jest.Mock;
  findByChapterAndName: jest.Mock;
  findByChapterAndSystemKey: jest.Mock;
  create: jest.Mock;
  createMany: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

/** The member repository methods `RbacService` reaches, each a jest mock. */
export type TieredMemberRepoMock = {
  findByUserAndChapter: jest.Mock;
  setSelfAssignedRole: jest.Mock;
};

export type TieredRbacHarness = {
  service: RbacService;
  /** The chapter's roles; the repository mocks read this same array. */
  roles: Role[];
  /** The chapter's tiers; the tier repository answers this same array. */
  tiers: RoleTier[];
  members: Member[];
  roleRepo: TieredRoleRepoMock;
  memberRepo: TieredMemberRepoMock;
  audit: AuditLogServiceMock;
};

/**
 * An `RbacService` wired to the tiered fixture chapter (#4071), for the specs
 * that walk the rank rules through it. The repositories behave like the
 * database over the chapter's roles, tiers and members: reads find them, a
 * role write comes back as the trigger would leave it, and a delete strips
 * nobody. `setSelfAssignedRole` has no behaviour until a spec gives it one.
 *
 * `roles` defaults to `tieredChapterRoles()`; a spec that adds roles of its
 * own passes the full list.
 */
export async function createTieredRbacHarness(
  roles: Role[] = tieredChapterRoles(),
): Promise<TieredRbacHarness> {
  const tiers = tieredChapterTiers();
  const members = tieredChapterMembers();
  const roleRepo: TieredRoleRepoMock = {
    findById: jest.fn(
      async (id: string) => roles.find((role) => role.id === id) ?? null,
    ),
    findByChapter: jest.fn().mockResolvedValue(roles),
    findByIds: jest.fn(),
    findByChapterAndName: jest.fn().mockResolvedValue(null),
    findByChapterAndSystemKey: jest.fn(),
    create: jest.fn(async (data: Partial<Role>) => ({
      ...data,
      id: 'role-new',
    })),
    createMany: jest.fn(),
    // What the database's trigger does with the write.
    update: jest.fn(async (id: string, data: Partial<Role>) => {
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
    }),
    delete: jest.fn().mockResolvedValue({
      strippedMemberIds: [],
      givenEveryoneMemberIds: [],
    }),
  };
  const memberRepo: TieredMemberRepoMock = {
    findByUserAndChapter: jest.fn(
      async (userId: string) =>
        members.find((member) => member.user_id === userId) ?? null,
    ),
    setSelfAssignedRole: jest.fn(),
  };
  const audit = createAuditLogServiceMock();

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

  return {
    service: module.get(RbacService),
    roles,
    tiers,
    members,
    roleRepo,
    memberRepo,
    audit,
  };
}
