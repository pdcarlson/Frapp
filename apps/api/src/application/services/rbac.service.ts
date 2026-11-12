import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import type { IRoleRepository } from '#domain/repositories/role.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '#domain/repositories/chapter.repository.interface';
import { ROLE_TIER_REPOSITORY } from '#domain/repositories/role-tier.repository.interface';
import type { IRoleTierRepository } from '#domain/repositories/role-tier.repository.interface';
import { CHAPTER_GROUP_REPOSITORY } from '#domain/repositories/chapter-group.repository.interface';
import type { IChapterGroupRepository } from '#domain/repositories/chapter-group.repository.interface';
import { groupKindOpensChannels } from '#domain/entities/chapter-group.entity';
import { Role, RoleTier } from '#domain/entities/role.entity';
import { Member } from '#domain/entities/member.entity';
import {
  EVERYONE_ROLE_NAME,
  isEveryoneRole,
  reservedMentionName,
  permissionDefinition,
  permissionModuleLabel,
} from '@repo/validation';
import {
  AI_PERMISSIONS,
  SystemPermissions,
  SystemRoleKeys,
  WILDCARD,
  type PermissionCatalogEntry,
} from '#domain/constants/permissions';
import { flattenPermissionSets } from '#domain/utils/permissions';
import { isAiEnabled } from '../../config/ai-config';
import {
  addedPermissions,
  canReach,
  OUTSIDE_TIERS_RANK,
  effectivePermissions,
  holderRank,
  permissionsNotHeld,
  roleRank,
  tierPositions,
  type ActorReach,
} from '#domain/utils/role-rank';
import {
  accessHolderFromRoles,
  EMPTY_ACCESS_HOLDER,
  type ChannelAccessHolder,
} from '#domain/utils/channel-access';
import {
  ChapterAuditLogService,
  type AuditDiff,
} from './chapter-audit-log.service';

/** `target_type` of the rows the Roles tab's writers record (#2599). */
const AUDIT_TARGET_TYPE = 'role';

/**
 * What a role edit records: one from/to pair per changed field, except
 * `permissions`, which records what was added and what was removed. A matrix
 * toggle changes one permission, and the whole array twice would bury it.
 */
type RoleUpdateDiff = Partial<
  Record<
    | 'name'
    | 'color'
    | 'display_order'
    | 'mentionable'
    | 'tier_id'
    | 'permission_overrides',
    { from: unknown; to: unknown }
  >
> & { permissions?: { added: string[]; removed: string[] } };

/** What a role edit through `PATCH /v1/roles/:id` may change. */
export interface RoleChanges {
  name?: string;
  permissions?: string[];
  display_order?: number;
  color?: string | null;
  mentionable?: boolean;
  /** Move to this tier; `null` moves the role outside the tiers. */
  tier_id?: string | null;
  /**
   * Overrides to set (`true` on, `false` off) or clear (`null`), merged into
   * what the role has. Keys not listed are left as they are.
   */
  permission_overrides?: Record<string, boolean | null>;
}

/** Refusal when the target ranks at or above the caller (#4071). */
export const RANK_REFUSAL =
  'You can only change roles and tiers ranked below your own.';

/** Refusal when a write would grant what the caller does not hold (#4071). */
function grantRefusal(missing: readonly string[]): string {
  return `You can't give a role or tier a permission you don't have yourself: ${missing.join(', ')}.`;
}

/** Refuses (403) when `granted` holds a permission the caller lacks. */
export function assertPermissionsHeld(
  reach: ActorReach,
  granted: Iterable<string>,
): void {
  const missing = permissionsNotHeld(reach, granted);
  if (missing.length > 0) {
    throw new ForbiddenException(grantRefusal(missing));
  }
}

/**
 * Who is acting and the chapter's roles and tiers, from one read of each, for
 * the rank rules (#4071). `roles` and `tiers` are re-scoped to the chapter.
 */
export interface RankContext {
  reach: ActorReach;
  roles: Role[];
  tiers: RoleTier[];
  positions: ReadonlyMap<string, number>;
}

/** The chapter's next-highest-ranked role that has at least one live holder,
 * once the (now-vacant) President role is excluded — the pool a presidency
 * claim may be made from. `null` when no other role has any members at all
 * (spec/behavior/rbac.md: "If no suitable member exists, Frapp support
 * intervenes"). */
interface EligibleClaimants {
  role: Role;
  memberIds: Set<string>;
}

/** One chapter member's resolved access, from {@link RbacService.getChapterMemberAccess}. */
export interface ChapterMemberAccess {
  user_id: string;
  permissions: Set<string>;
  /** Smallest `display_order` among held live roles; `null` when none. */
  top_role_order: number | null;
  /**
   * The held live role that `top_role_order` belongs to (ties broken by name,
   * then id, so the pick is stable), or `null` when none. Chat's member list
   * groups readers under it; `everyone` marks the chapter's Everyone role
   * (#4191), which that list never names.
   */
  top_role: { id: string; name: string; everyone?: true } | null;
  /** What the member holds for a channel's who-can-see and who-can-post lists (#3722). */
  channel_access: ChannelAccessHolder;
}

/**
 * The highest of a member's roles: lowest `display_order` (as on the Roles
 * page), ties broken by name, then id, so two calls agree.
 */
function topRole(roles: readonly Role[]): Role | null {
  let best: Role | null = null;
  for (const role of roles) {
    if (
      !best ||
      role.display_order < best.display_order ||
      (role.display_order === best.display_order &&
        (role.name.localeCompare(best.name) < 0 ||
          (role.name === best.name && role.id < best.id)))
    ) {
      best = role;
    }
  }
  return best;
}

@Injectable()
export class RbacService {
  constructor(
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapterRepo: IChapterRepository,
    @Inject(ROLE_TIER_REPOSITORY)
    private readonly tierRepo: IRoleTierRepository,
    private readonly chapterAuditLogService: ChapterAuditLogService,
    @Inject(CHAPTER_GROUP_REPOSITORY)
    private readonly groupRepo: IChapterGroupRepository,
  ) {}

  /**
   * The acting member's reach and the chapter's roles and tiers (#4071). A
   * caller with no membership, or whose roles are all gone, ranks outside the
   * tiers and holds nothing, so every rank rule refuses them.
   */
  async getRankContext(
    chapterId: string,
    userId: string,
  ): Promise<RankContext> {
    const [member, allRoles, allTiers] = await Promise.all([
      this.memberRepo.findByUserAndChapter(userId, chapterId),
      this.roleRepo.findByChapter(chapterId),
      this.tierRepo.findByChapter(chapterId),
    ]);
    const roles = allRoles.filter((role) => role.chapter_id === chapterId);
    const tiers = allTiers.filter((tier) => tier.chapter_id === chapterId);
    const positions = tierPositions(tiers);
    // `role_ids` is not foreign-keyed and may carry a stale, foreign or
    // upper-case id; only this chapter's live roles count, as in the guard.
    const roleById = new Map(
      roles.map((role) => [role.id.toLowerCase(), role] as const),
    );
    const held = (
      member && member.chapter_id === chapterId ? member.role_ids : []
    )
      .map((id) => roleById.get(id.toLowerCase()))
      .filter((role): role is Role => role !== undefined);
    const permissions = flattenPermissionSets(held.map((r) => r.permissions));
    return {
      reach: {
        memberId: member?.id ?? null,
        rank: holderRank(held, positions),
        permissions,
        wildcard: permissions.has(WILDCARD),
      },
      roles,
      tiers,
      positions,
    };
  }

  /**
   * `POST /v1/roles` for a member: {@link create} behind the rank rules. The
   * role may only go into a tier ranked below the caller, or outside the
   * tiers (below every tier, so refused to a caller who ranks there too),
   * and may only hold permissions the caller holds.
   */
  async createAsMember(
    chapterId: string,
    actorUserId: string,
    data: Pick<
      RoleChanges,
      'name' | 'permissions' | 'display_order' | 'color' | 'mentionable'
    > & { tier_id?: string | null },
  ): Promise<Role> {
    const context = await this.getRankContext(chapterId, actorUserId);
    if (!canReach(context.reach, OUTSIDE_TIERS_RANK)) {
      throw new ForbiddenException(RANK_REFUSAL);
    }
    const tierId = data.tier_id ?? null;
    let tierPermissions: readonly string[] = [];
    if (tierId !== null) {
      const tier = this.chapterTier(context, tierId);
      if (!canReach(context.reach, tier.position)) {
        throw new ForbiddenException(RANK_REFUSAL);
      }
      tierPermissions = tier.permissions;
    }
    // A role created with a list holds exactly that list (the database
    // records the difference from its tier as overrides); one created with
    // none takes its tier's.
    const listed = data.permissions ?? [];
    const holds = listed.length > 0 ? listed : tierPermissions;
    assertPermissionsHeld(context.reach, holds);
    return this.create(chapterId, actorUserId, { ...data, tier_id: tierId });
  }

  /**
   * `PATCH /v1/roles/:id` for a member: {@link update} behind the rank rules.
   *
   * - The role must rank below the caller, and so must a tier it moves into.
   * - Nothing the role holds afterwards that it did not hold before may be a
   *   permission the caller lacks, and nor may an override switched on.
   * - `permissions` is a whole list (the Roles matrix and module pages send
   *   it); `tier_id` and `permission_overrides` edit the tier model. One
   *   request does one or the other, so its result is never ambiguous.
   */
  async updateAsMember(
    roleId: string,
    chapterId: string,
    actorUserId: string,
    data: RoleChanges,
  ): Promise<Role> {
    if (
      data.permissions !== undefined &&
      (data.tier_id !== undefined || data.permission_overrides !== undefined)
    ) {
      throw new BadRequestException(
        'Send either permissions, or tier_id and permission_overrides, not both',
      );
    }
    for (const [permission, on] of Object.entries(
      data.permission_overrides ?? {},
    )) {
      if (
        permission.trim() === '' ||
        (on !== true && on !== false && on !== null)
      ) {
        throw new BadRequestException(
          'permission_overrides maps a permission to true, false or null',
        );
      }
    }
    const context = await this.getRankContext(chapterId, actorUserId);
    const role = await this.roleInChapter(roleId, chapterId);
    if (!canReach(context.reach, roleRank(role, context.positions))) {
      throw new ForbiddenException(RANK_REFUSAL);
    }

    let tierId = role.tier_id;
    if (data.tier_id !== undefined) {
      tierId = data.tier_id;
      if (tierId !== null) {
        const tier = this.chapterTier(context, tierId);
        if (!canReach(context.reach, tier.position)) {
          throw new ForbiddenException(RANK_REFUSAL);
        }
      }
    }

    let overrides = role.permission_overrides ?? {};
    const switchedOn: string[] = [];
    if (data.permission_overrides !== undefined) {
      overrides = mergeOverrides(overrides, data.permission_overrides);
      for (const [permission, on] of Object.entries(
        data.permission_overrides,
      )) {
        if (on === true && role.permission_overrides?.[permission] !== true) {
          switchedOn.push(permission);
        }
      }
    }

    let after: readonly string[] = role.permissions;
    if (data.permissions !== undefined) {
      after = data.permissions;
    } else if (
      data.tier_id !== undefined ||
      data.permission_overrides !== undefined
    ) {
      const tier =
        tierId === null
          ? undefined
          : context.tiers.find((candidate) => candidate.id === tierId);
      after = effectivePermissions(tier?.permissions ?? [], overrides);
    }
    assertPermissionsHeld(context.reach, [
      ...addedPermissions(role.permissions, after),
      ...switchedOn,
    ]);

    const changes: Partial<Role> = {
      name: data.name,
      permissions: data.permissions,
      display_order: data.display_order,
      color: data.color,
      mentionable: data.mentionable,
      tier_id: data.tier_id,
      permission_overrides:
        data.permission_overrides === undefined ? undefined : overrides,
    };
    return this.update(
      roleId,
      chapterId,
      actorUserId,
      withoutUndefined(changes),
    );
  }

  /** `DELETE /v1/roles/:id` for a member: only a role ranked below them. */
  async deleteAsMember(
    roleId: string,
    chapterId: string,
    actorUserId: string,
  ): Promise<void> {
    const context = await this.getRankContext(chapterId, actorUserId);
    const role = await this.roleInChapter(roleId, chapterId);
    if (!canReach(context.reach, roleRank(role, context.positions))) {
      throw new ForbiddenException(RANK_REFUSAL);
    }
    return this.delete(roleId, chapterId, actorUserId);
  }

  /** One of the chapter's tiers, or 400: a tier id is caller-supplied. */
  private chapterTier(context: RankContext, tierId: string): RoleTier {
    const tier = context.tiers.find((candidate) => candidate.id === tierId);
    if (!tier) {
      throw new BadRequestException(
        "tier_id must name one of this chapter's tiers",
      );
    }
    return tier;
  }

  /** The role, 404 when there is none and 403 when it is another chapter's. */
  private async roleInChapter(
    roleId: string,
    chapterId: string,
  ): Promise<Role> {
    const role = await this.roleRepo.findById(roleId);
    if (!role) throw new NotFoundException('Role not found');
    if (role.chapter_id !== chapterId)
      throw new ForbiddenException('Role not in current chapter');
    return role;
  }

  async findByChapter(chapterId: string): Promise<Role[]> {
    return this.roleRepo.findByChapter(chapterId);
  }

  /**
   * `onCreated` runs after the role is inserted and before its audit row is
   * written, for a caller that must record the new id whatever the audit write
   * then does. The audit write can fail after the role exists (#1599), and a
   * Discord import that had not recorded the id by then would refuse its own
   * retry over the role it just made. The role exists whether or not
   * `onCreated` succeeds, so its audit row is written either way.
   */
  async create(
    chapterId: string,
    actorUserId: string,
    data: Partial<Role>,
    onCreated?: (role: Role) => Promise<void>,
  ): Promise<Role> {
    // Only the seeded President role may carry the wildcard: letting
    // `roles:manage` mint a new `*` role would bypass the presidency-transfer
    // safeguard entirely (spec/behavior/rbac.md).
    if (data.permissions?.includes(WILDCARD)) {
      throw new BadRequestException(
        'New roles cannot carry the wildcard (*) permission; use the presidency-transfer flow instead',
      );
    }

    assertNotReservedMentionName(data.name);
    const existing = await this.roleRepo.findByChapterAndName(
      chapterId,
      data.name!,
    );
    if (existing)
      throw new ConflictException('Role name already exists in this chapter');

    const role = await this.roleRepo.create({
      ...data,
      chapter_id: chapterId,
      is_system: false,
      // A caller-supplied `system_key` would let `roles:manage` mint a role
      // that impersonates a seeded one — claiming ALUMNI would hand its
      // lifecycle restrictions to that role's holders. Custom roles never
      // carry a key.
      system_key: null,
    });
    try {
      await onCreated?.(role);
    } finally {
      await this.chapterAuditLogService.record({
        chapterId,
        actorUserId,
        action: 'role_created',
        targetType: AUDIT_TARGET_TYPE,
        targetId: role.id,
        diff: { role: { from: null, to: role } } satisfies AuditDiff,
      });
    }
    return role;
  }

  /**
   * Writes one `role_updated` row naming the fields that changed, or none when
   * the saved row matches the old one: a PATCH that re-sends what the role
   * already holds changed nothing a member would want in `#chapter-audit`.
   */
  async update(
    roleId: string,
    chapterId: string,
    actorUserId: string,
    data: Partial<Role>,
  ): Promise<Role> {
    const role = await this.roleRepo.findById(roleId);
    if (!role) throw new NotFoundException('Role not found');
    if (role.chapter_id !== chapterId)
      throw new ForbiddenException('Role not in current chapter');

    // An update may keep a wildcard the role already holds (the President
    // role's permissions stay editable) but may never introduce one — that
    // would mint a second wildcard holder outside the transfer flow.
    if (
      data.permissions?.includes(WILDCARD) &&
      !role.permissions.includes(WILDCARD)
    ) {
      throw new BadRequestException(
        'The wildcard (*) permission cannot be added to a role; use the presidency-transfer flow instead',
      );
    }

    // Nor may the seeded President role lose its wildcard: with introduction
    // blocked above, a strip would be unrecoverable through the API and leave
    // the chapter without any wildcard holder (spec/behavior/rbac.md — the
    // President role always carries `*`). Legacy non-system roles carrying a
    // pre-validation `*` stay strippable, as that is their cleanup path.
    if (
      role.is_system &&
      role.permissions.includes(WILDCARD) &&
      data.permissions &&
      !data.permissions.includes(WILDCARD)
    ) {
      throw new BadRequestException(
        'The President role must keep the wildcard (*) permission; use the presidency-transfer flow to move it',
      );
    }

    // The wildcard is an override on the President role (#4071); it moves only
    // through presidency transfer, so no override write may add, remove or
    // flip it.
    if (
      data.permission_overrides !== undefined &&
      data.permission_overrides[WILDCARD] !==
        role.permission_overrides?.[WILDCARD]
    ) {
      throw new BadRequestException(
        'The wildcard (*) permission cannot be set or cleared as an override; use the presidency-transfer flow instead',
      );
    }

    // The Everyone role (#4191) is the base under every tier: it keeps its
    // name, which `@everyone` reads, and its tier, which is where plain
    // members rank and where presidency's claim walk stops. Its permissions
    // and its `@everyone` switch stay editable. Two moves stay open because
    // they only bring it to where it belongs: renaming it Everyone (a row
    // the previous API seeded as Member after the migration ran), and
    // putting it in a tier when it sits outside them.
    if (role.system_key === SystemRoleKeys.MEMBER) {
      if (
        data.name !== undefined &&
        data.name !== role.name &&
        data.name !== EVERYONE_ROLE_NAME
      ) {
        throw new BadRequestException({
          code: 'role.everyone_fixed',
          message: 'The Everyone role keeps its name.',
        });
      }
      if (
        data.tier_id !== undefined &&
        data.tier_id !== role.tier_id &&
        !(role.tier_id === null && data.tier_id !== null)
      ) {
        throw new BadRequestException({
          code: 'role.everyone_fixed',
          message: 'The Everyone role stays in its tier.',
        });
      }
    } else if (data.name && data.name !== role.name) {
      assertNotReservedMentionName(data.name);
    }

    if (data.name && data.name !== role.name) {
      const existing = await this.roleRepo.findByChapterAndName(
        role.chapter_id,
        data.name,
      );
      if (existing)
        throw new ConflictException('Role name already exists in this chapter');
    }

    // `system_key` is the identity every authorization and lifecycle lookup
    // resolves on, so it is immutable through the API: moving or clearing it
    // would reintroduce exactly the detach-by-rename hole it was added to
    // close. Renaming a system role stays allowed — it is now only a relabel.
    const updatable = { ...data };
    delete updatable.system_key;

    const updated = await this.roleRepo.update(roleId, updatable);
    const diff = diffRole(role, updated);
    if (Object.keys(diff).length > 0) {
      await this.chapterAuditLogService.record({
        chapterId,
        actorUserId,
        action: 'role_updated',
        targetType: AUDIT_TARGET_TYPE,
        targetId: roleId,
        diff,
      });
    }
    return updated;
  }

  async delete(
    roleId: string,
    chapterId: string,
    actorUserId: string,
  ): Promise<void> {
    const role = await this.roleRepo.findById(roleId);
    if (!role) throw new NotFoundException('Role not found');
    if (role.chapter_id !== chapterId)
      throw new ForbiddenException('Role not in current chapter');
    if (role.is_system)
      throw new ForbiddenException('Cannot delete system roles');

    await this.roleRepo.delete(roleId);
    await this.chapterAuditLogService.record({
      chapterId,
      actorUserId,
      action: 'role_deleted',
      targetType: AUDIT_TARGET_TYPE,
      targetId: roleId,
      diff: { role: { from: role, to: null } } satisfies AuditDiff,
    });
  }

  async transferPresidency(
    chapterId: string,
    currentMemberId: string,
    targetMemberId: string,
  ): Promise<void> {
    if (currentMemberId === targetMemberId) {
      // A self-transfer would strip then re-add the wildcard role on the same
      // row — a no-op the RPC would otherwise report as success.
      throw new BadRequestException(
        'Cannot transfer presidency to the current President',
      );
    }

    const currentMember = await this.memberRepo.findById(currentMemberId);
    const targetMember = await this.memberRepo.findById(targetMemberId);

    if (!currentMember || !targetMember) {
      throw new NotFoundException('Member not found');
    }

    if (targetMember.chapter_id !== chapterId) {
      throw new BadRequestException('Target member is not in this chapter');
    }

    if (currentMember.chapter_id !== chapterId) {
      throw new BadRequestException('Current member is not in this chapter');
    }

    const roles = await this.roleRepo.findByChapter(chapterId);
    const presidentRole = this.findPresidentRole(roles);

    if (!presidentRole) {
      throw new NotFoundException('President role not found');
    }

    const currentHasPresident = currentMember.role_ids.includes(
      presidentRole.id,
    );
    if (!currentHasPresident) {
      throw new ForbiddenException(
        'Only the current President can transfer presidency',
      );
    }

    // Persist the removal from the current President and the addition to the
    // target in a single DB transaction (the `transfer_presidency` RPC), so a
    // partial failure can never leave the chapter with zero or two Presidents.
    const transferred = await this.memberRepo.transferPresidencyAtomic(
      chapterId,
      currentMember.id,
      targetMember.id,
      presidentRole.id,
    );

    // `false` => the current President no longer holds the wildcard role in the
    // chapter (a concurrent transfer already moved it, or the membership was
    // stale between the read above and this write). Same outcome as the
    // in-memory guard: only the current President can transfer presidency.
    if (!transferred) {
      throw new ForbiddenException(
        'Only the current President can transfer presidency',
      );
    }

    await this.chapterAuditLogService.record({
      chapterId,
      actorUserId: currentMember.user_id,
      action: 'presidency_transferred',
      targetType: 'chapter',
      targetId: chapterId,
      diff: {
        president_member_id: { from: currentMember.id, to: targetMember.id },
      } satisfies AuditDiff,
    });
  }

  /** Resolve the chapter's seeded President role by identity (wildcard-carrying
   * system role) rather than `system_key`, matching {@link transferPresidency}:
   * the legacy `system_key` backfill gap (spec/behavior/rbac.md — a chapter
   * that renamed a system role before the backfill has no key on it) means
   * `system_key` alone cannot be trusted to find every chapter's President. */
  private findPresidentRole(roles: Role[]): Role | undefined {
    return roles.find((r) => r.is_system && r.permissions.includes(WILDCARD));
  }

  /**
   * Walk the chapter's roles by ascending `display_order` (i.e. descending
   * rank), skipping the vacant President role, and return the first role that
   * still has at least one live member holding it. That role's holders are
   * the pool "the next member with the highest-ranked **admin** role" in
   * spec/behavior/rbac.md resolves to — not a hardcoded `SystemRoleKeys` list,
   * since `display_order` is chapter-editable and a chapter may add, rename or
   * reorder roles freely.
   *
   * The walk is floored at the chapter's seeded "Member" role's
   * `display_order` — roles ranked at or below that are the ordinary-member
   * baseline, not an admin tier, and every active chapter has at least one
   * member holding one. Without this floor, a chapter with every officer
   * seat vacant would fall all the way through to "Member" and let any
   * ordinary member (there may be dozens) claim the wildcard. Returns `null`
   * (the support-fallback case) when the chapter's Member role cannot be
   * resolved by `system_key` at all (the legacy backfill gap) — fail closed
   * rather than removing the floor, since this decision grants `*`.
   */
  private async resolveEligibleClaimants(
    chapterId: string,
    roles: Role[],
    presidentRole: Role,
  ): Promise<EligibleClaimants | null> {
    const memberRole = roles.find(
      (r) => r.system_key === SystemRoleKeys.MEMBER,
    );
    if (!memberRole) return null;

    // Ranked by tier, not by `display_order`, which a `roles:manage` holder
    // can set on a role below them (#4071): an empty role outside the tiers
    // at display_order 0 would otherwise make its holder the only claimant.
    // Only roles in a tier ranked above the Everyone role's (the seeded
    // Member role, #4191) are candidates; display_order breaks ties within a
    // tier. Everyone can't leave its tier (`update`), so the floor stays:
    // outside the tiers it would rank below every tier and open the claim to
    // the Members and New members tiers.
    const positions = tierPositions(
      await this.tierRepo.findByChapter(chapterId),
    );
    const memberRank = roleRank(memberRole, positions);
    const candidateRoles = roles
      .filter((r) => {
        const rank = roleRank(r, positions);
        return (
          r.id !== presidentRole.id &&
          r.id !== memberRole.id &&
          Number.isFinite(rank) &&
          rank < memberRank
        );
      })
      .sort(
        (a, b) =>
          roleRank(a, positions) - roleRank(b, positions) ||
          a.display_order - b.display_order,
      );
    if (!candidateRoles.length) return null;

    const members = await this.memberRepo.findByChapter(chapterId);
    for (const role of candidateRoles) {
      const memberIds = new Set(
        members.filter((m) => m.role_ids.includes(role.id)).map((m) => m.id),
      );
      if (memberIds.size > 0) return { role, memberIds };
    }
    return null;
  }

  /**
   * Set after the member holding the wildcard-carrying President role is
   * removed from the chapter (`MemberService.remove`) or their account is
   * anonymized (`AccountDeletionService`) — the two orphaning causes
   * spec/behavior/rbac.md's Presidency Transfer "Edge case" names. A no-op
   * when the removed member did not hold the President role, or the chapter
   * has none (a chapter mid-onboarding, or one whose seeded roles were
   * otherwise never created).
   *
   * `actorUserId` is null when the caller is the system itself (account
   * deletion has no acting member), matching {@link ChapterAuditLogService}'s
   * contract.
   */
  async flagIfPresidentRemoved(
    chapterId: string,
    removedMemberRoleIds: string[],
    actorUserId: string | null,
  ): Promise<void> {
    if (!removedMemberRoleIds.length) return;

    const roles = await this.roleRepo.findByChapter(chapterId);
    const presidentRole = this.findPresidentRole(roles);
    if (!presidentRole || !removedMemberRoleIds.includes(presidentRole.id)) {
      return;
    }

    await this.chapterRepo.update(chapterId, { needs_president: true });
    await this.chapterAuditLogService.record({
      chapterId,
      actorUserId,
      action: 'president_orphaned',
      targetType: 'chapter',
      targetId: chapterId,
      diff: {},
    });
  }

  /**
   * Whether `memberId` may claim the chapter's vacant presidency right now,
   * for the Roles page's claim banner (rendered to every member, since the
   * eligible claimant is by definition not the outgoing President and is
   * often not a `roles:manage` holder either).
   */
  async getPresidencyClaimStatus(
    chapterId: string,
    memberId: string,
  ): Promise<{
    needs_president: boolean;
    eligible: boolean;
    next_role_name: string | null;
  }> {
    const chapter = await this.chapterRepo.findById(chapterId);
    if (!chapter) throw new NotFoundException('Chapter not found');
    if (!chapter.needs_president) {
      return { needs_president: false, eligible: false, next_role_name: null };
    }

    const roles = await this.roleRepo.findByChapter(chapterId);
    const presidentRole = this.findPresidentRole(roles);
    if (!presidentRole) {
      return { needs_president: true, eligible: false, next_role_name: null };
    }

    const eligible = await this.resolveEligibleClaimants(
      chapterId,
      roles,
      presidentRole,
    );
    return {
      needs_president: true,
      eligible: eligible?.memberIds.has(memberId) ?? false,
      next_role_name: eligible?.role.name ?? null,
    };
  }

  /**
   * Claim the chapter's vacant presidency. Only reachable when
   * `chapters.needs_president` is set and `claimingMemberId` holds the
   * chapter's next-highest-ranked role with a live member — see
   * {@link resolveEligibleClaimants}. The actual role grant is atomic
   * (`claim_presidency` RPC via {@link IMemberRepository.claimPresidencyAtomic}),
   * so two eligible members racing to claim resolve to exactly one winner.
   */
  async claimPresidency(
    chapterId: string,
    claimingMemberId: string,
  ): Promise<void> {
    const chapter = await this.chapterRepo.findById(chapterId);
    if (!chapter) throw new NotFoundException('Chapter not found');
    if (!chapter.needs_president) {
      throw new BadRequestException(
        'This chapter does not need a new President',
      );
    }

    const claimingMember = await this.memberRepo.findById(claimingMemberId);
    if (!claimingMember || claimingMember.chapter_id !== chapterId) {
      throw new NotFoundException('Member not found');
    }

    const roles = await this.roleRepo.findByChapter(chapterId);
    const presidentRole = this.findPresidentRole(roles);
    if (!presidentRole) {
      throw new NotFoundException('President role not found');
    }

    const eligible = await this.resolveEligibleClaimants(
      chapterId,
      roles,
      presidentRole,
    );
    if (!eligible || !eligible.memberIds.has(claimingMemberId)) {
      throw new ForbiddenException(
        "Only a member holding the chapter's next-highest-ranked role can claim the presidency",
      );
    }

    const claimed = await this.memberRepo.claimPresidencyAtomic(
      chapterId,
      claimingMemberId,
      eligible.role.id,
      presidentRole.id,
    );
    if (!claimed) {
      throw new ConflictException(
        'This chapter no longer needs a new President — someone else already claimed it',
      );
    }

    await this.chapterAuditLogService.record({
      chapterId,
      actorUserId: claimingMember.user_id,
      action: 'presidency_claimed',
      targetType: 'chapter',
      targetId: chapterId,
      diff: { claimed_by_member_id: claimingMemberId },
    });
  }

  /**
   * Every system permission with the registry's words for it. `key` is the
   * API constant's name, kept because clients already key on it; the label,
   * description, module and scope come from `PERMISSION_REGISTRY`.
   */
  getPermissionsCatalog(): PermissionCatalogEntry[] {
    // With the server's AI switch off, a role editor reads exactly as it did
    // before the AI permissions existed.
    const offered = Object.entries(SystemPermissions).filter(
      ([, value]) => isAiEnabled() || !AI_PERMISSIONS.has(value),
    );
    return offered.map(([key, value]) => {
      const definition = permissionDefinition(value);
      if (!definition) {
        // `permissions.spec.ts` pins the two lists together, so this is a
        // build that skipped its tests.
        throw new Error(`Permission ${value} has no registry entry`);
      }
      return {
        key,
        ...definition,
        module_label: permissionModuleLabel(definition.module),
      };
    });
  }

  async memberHasAnyPermission(
    chapterId: string,
    userId: string,
    permissions: string[],
  ): Promise<boolean> {
    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    const userPermissions = await this.resolvePermissionSet(chapterId, member);
    if (userPermissions.has(WILDCARD)) return true;
    return permissions.some((p) => userPermissions.has(p));
  }

  /**
   * Whether `userId` holds the chapter's Alumni system role.
   *
   * Alumni are read-mostly: the spec excludes them from points accumulation,
   * event check-in, and study hours, and limits their chat posting to
   * `#alumni` and direct conversations (`spec/behavior/alumni.md`). This is a
   * lifecycle check, not a permission check — holding the role is what
   * restricts, so a member who still needs to act operationally should not
   * carry it.
   *
   * Returns `false` when the chapter has no Alumni role or the caller is not a
   * member, so callers fail open to their normal permission checks rather than
   * locking everyone out of a chapter whose Alumni role was renamed/removed.
   */
  async isAlumni(chapterId: string, userId: string): Promise<boolean> {
    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    return this.hasAlumniRole(chapterId, member?.role_ids);
  }

  /**
   * {@link isAlumni} for callers that already hold the member's role ids —
   * notably the chat hot path, which looks the member up to decide channel
   * access and must not re-fetch it on every message. Still costs the role
   * lookup itself, so callers should only reach for it when the answer can
   * change the outcome.
   */
  async hasAlumniRole(
    chapterId: string,
    roleIds: string[] | null | undefined,
  ): Promise<boolean> {
    if (!roleIds?.length) return false;

    const alumniRoleId = await this.getAlumniRoleId(chapterId);
    if (!alumniRoleId) return false;

    return roleIds.includes(alumniRoleId);
  }

  /**
   * Id of the chapter's Alumni role, or `null` when it has none. Exposed for
   * callers that classify a batch of members rather than asking about one —
   * e.g. excluding alumni from auto-absent marking — so they resolve the role
   * once instead of per member.
   *
   * Resolves on `system_key`, so renaming the role no longer detaches the
   * lifecycle restrictions from it. `null` now means the role was genuinely
   * never seeded or was renamed *before* the FRA-320 backfill, not merely
   * relabelled.
   */
  async getAlumniRoleId(chapterId: string): Promise<string | null> {
    const alumniRole = await this.roleRepo.findByChapterAndSystemKey(
      chapterId,
      SystemRoleKeys.ALUMNI,
    );
    return alumniRole?.id ?? null;
  }

  /**
   * Resolve a caller's effective permission set for a chapter.
   *
   * Mirrors the flattening logic in `PermissionsGuard` so web and mobile
   * clients can render permission-aware UI (hide nav items, disable actions,
   * route users to `/no-access`) without making one request per role or
   * duplicating RBAC rules in client code. Wildcard `*` passes through so the
   * caller can short-circuit rendering for Presidents. Role ids resolve within
   * `chapterId`, as in the guard, so what the client renders can never be
   * widened by a role id belonging to another chapter.
   */
  async getEffectivePermissions(
    chapterId: string,
    userId: string,
  ): Promise<string[]> {
    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    const set = await this.resolvePermissionSet(chapterId, member);
    return Array.from(set).sort();
  }

  /**
   * What a member holds for channel lists (#3722): their roles in this chapter,
   * their tiers, `*`, and whether one is the Alumni role. One read of
   * `roles`, re-scoped to the chapter, so a stale or foreign id in
   * `role_ids` contributes nothing. The chat hot path calls it only when a
   * list or the Alumni rule can decide (`needsAccessHolder`).
   *
   * `withGroups` adds the groups they are in (#4076), a second read in
   * parallel. A caller passes `listsNameGroups` of the channels it decides,
   * so a channel no list of which names a group costs nothing more; without
   * them a `group:` entry admits nobody but `*` (fails closed).
   */
  async getChannelAccessHolder(
    chapterId: string,
    member: Pick<Member, 'user_id' | 'role_ids'> | null | undefined,
    withGroups = false,
  ): Promise<ChannelAccessHolder> {
    if (!member) return EMPTY_ACCESS_HOLDER;
    const roleIds = member.role_ids ?? [];
    const [roles, groupIds] = await Promise.all([
      roleIds.length > 0
        ? this.roleRepo.findByIds([...roleIds], chapterId)
        : Promise.resolve([]),
      withGroups
        ? this.groupRepo.findGroupIdsForUser(chapterId, member.user_id)
        : Promise.resolve([]),
    ]);
    if (roles.length === 0 && groupIds.length === 0) {
      return EMPTY_ACCESS_HOLDER;
    }
    return accessHolderFromRoles(
      roles.filter((role) => role.chapter_id === chapterId),
      groupIds,
    );
  }

  /**
   * The `users.id` of every member of `chapterId` whose effective permissions
   * satisfy **all** of `permissions` — the wildcard satisfies any list — for
   * addressing a notification to "whoever in this chapter can act on it"
   * (#2257: officers are told when a chat message is reported).
   *
   * All-of, matching `@RequirePermissions`, so a caller can pass a route's full
   * requirement and get exactly the members that route would admit. The report
   * queue needs `members:view` **and** `channels:manage`, and notifying a member
   * who holds only the second would send them to a queue that 403s.
   *
   * **Three reads, not one per member**, through
   * {@link getChapterMemberAccess}, which owns the chapter-wide resolve and its
   * re-scoping; walking the roster through `getEffectivePermissions` would be
   * ~2N queries on a request path.
   */
  async findUserIdsWithPermissions(
    chapterId: string,
    permissions: readonly string[],
  ): Promise<string[]> {
    return this.findUserIdsWithAnyPermissions(chapterId, [permissions]);
  }

  /**
   * Like {@link findUserIdsWithPermissions}, for an audience that more than one
   * route's requirement admits: the members who satisfy **all** of **any one**
   * of `requirements` (an OR of ANDs), from one chapter-wide resolve rather
   * than one per requirement. The member-joined push (#3656) goes to whoever
   * can open the roster and either invite or give the new member a role.
   * An empty `requirements` list admits nobody.
   */
  async findUserIdsWithAnyPermissions(
    chapterId: string,
    requirements: readonly (readonly string[])[],
  ): Promise<string[]> {
    if (requirements.length === 0) return [];
    const access = await this.getChapterMemberAccess(chapterId);
    return access
      .filter(
        ({ permissions: granted }) =>
          granted.has(WILDCARD) ||
          requirements.some((permissions) =>
            permissions.every((permission) => granted.has(permission)),
          ),
      )
      .map(({ user_id }) => user_id);
  }

  /**
   * Every member of `chapterId` with their flattened effective permissions and
   * the rank of their highest role, from two reads (roster and roles) rather
   * than ~2N. The one place a chapter-wide permission resolve is
   * built, so {@link findUserIdsWithPermissions} and the channel member list
   * (`ChannelAccessService.listChannelMembers`) cannot disagree about who holds
   * what.
   *
   * `top_role_order` is the smallest `display_order` among the member's live
   * roles in this chapter (lower ranks higher, as on the Roles page), or `null`
   * for a member who holds none.
   *
   * **Re-scoped to the chapter twice over.** Both reads filter on
   * `chapter_id`, and the role maps below additionally drop any row whose
   * `chapter_id` is not this one: a member's `role_ids` array is not
   * foreign-keyed, so a stale or cross-chapter id in it must contribute
   * nothing, exactly as the per-member resolver's `findByIds(ids, chapterId)`
   * guarantees. A user with two membership rows (the read is not keyed on
   * user) gets one entry with both rows' roles unioned.
   *
   * `withGroups` also reads who is in each group (#4076), so `channel_access`
   * carries `group:` entries: the push audience and the channel member list
   * pass it for a channel whose lists name a group (`listsNameGroups`).
   */
  async getChapterMemberAccess(
    chapterId: string,
    withGroups = false,
  ): Promise<ChapterMemberAccess[]> {
    const [members, roles, memberships] = await Promise.all([
      this.memberRepo.findByChapter(chapterId),
      this.roleRepo.findByChapter(chapterId),
      withGroups
        ? this.groupRepo.findMemberships(chapterId)
        : Promise.resolve([]),
    ]);
    const groupsOf = new Map<string, string[]>();
    for (const { user_id, group_id, kind } of memberships) {
      // A class year opens no channel, as `findGroupIdsForUser` and
      // `can_read_chat_channel` read it.
      if (!groupKindOpensChannels(kind)) continue;
      const list = groupsOf.get(user_id);
      if (list) list.push(group_id);
      else groupsOf.set(user_id, [group_id]);
    }

    const roleById = new Map(
      roles
        .filter((role) => role.chapter_id === chapterId)
        .map((role) => [role.id.toLowerCase(), role] as const),
    );

    const held = new Map<string, string[]>();
    for (const member of members) {
      if (member.chapter_id !== chapterId) continue;
      const roleIds = held.get(member.user_id) ?? [];
      roleIds.push(...(member.role_ids ?? []));
      held.set(member.user_id, roleIds);
    }

    return [...held].map(([userId, roleIds]) => {
      // `role_ids` is not foreign-keyed and may hold an uppercase id; the
      // per-member read (`findByIds`, a uuid `in`) and `can_read_chat_channel`
      // match it case-insensitively, so this does too, or the push audience
      // would drift from the read audience.
      const liveRoles = [
        ...new Set(
          roleIds
            .map((id) => roleById.get(id.toLowerCase()))
            .filter((role): role is Role => role !== undefined),
        ),
      ];
      const top = topRole(liveRoles);
      return {
        user_id: userId,
        permissions: flattenPermissionSets(
          liveRoles.map((role) => role.permissions),
        ),
        top_role_order: top?.display_order ?? null,
        top_role: top
          ? {
              id: top.id,
              name: top.name,
              ...(isEveryoneRole(top) ? { everyone: true } : {}),
            }
          : null,
        channel_access: accessHolderFromRoles(
          liveRoles,
          groupsOf.get(userId) ?? [],
        ),
      };
    });
  }

  /**
   * Flatten a member's role permissions into one set. The lookup resolves
   * within `chapterId`, so stale or cross-chapter ids contribute nothing.
   * The flatten policy itself lives in `flattenPermissionSets`, shared with
   * `PermissionsGuard` so the two can never drift.
   */
  private async resolvePermissionSet(
    chapterId: string,
    member: Member | null,
  ): Promise<Set<string>> {
    const roleIds = member?.role_ids ?? [];
    if (!roleIds.length) return new Set();

    const roles = await this.roleRepo.findByIds(roleIds, chapterId);
    return flattenPermissionSets(roles.map((r) => r.permissions));
  }
}

/**
 * The audited difference between a role before and after an update, compared
 * on the saved row rather than the request so it records what persisted.
 * Permissions compare as sets: reordering the array is not a change.
 */
function diffRole(before: Role, after: Role): RoleUpdateDiff {
  const diff: RoleUpdateDiff = {};
  for (const field of [
    'name',
    'color',
    'display_order',
    'mentionable',
    'tier_id',
  ] as const) {
    if (before[field] !== after[field]) {
      diff[field] = { from: before[field], to: after[field] };
    }
  }
  // Overrides as a whole map: a role has a handful, and seeing both sides is
  // what tells a reader an override was cleared rather than switched off.
  if (
    canonicalOverrides(before.permission_overrides) !==
    canonicalOverrides(after.permission_overrides)
  ) {
    diff.permission_overrides = {
      from: before.permission_overrides ?? {},
      to: after.permission_overrides ?? {},
    };
  }
  const was = new Set(before.permissions ?? []);
  const now = new Set(after.permissions ?? []);
  const added = [...now].filter((permission) => !was.has(permission)).sort();
  const removed = [...was].filter((permission) => !now.has(permission)).sort();
  if (added.length > 0 || removed.length > 0) {
    diff.permissions = { added, removed };
  }
  return diff;
}

/** Overrides as a stable string, for comparing two maps. */
function canonicalOverrides(
  overrides: Readonly<Record<string, boolean>> | null | undefined,
): string {
  return JSON.stringify(
    Object.entries(overrides ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * A role's overrides with a patch applied: `true` and `false` set the
 * override, `null` clears it, and a key not in the patch is kept.
 */
function mergeOverrides(
  current: Readonly<Record<string, boolean>>,
  patch: Readonly<Record<string, boolean | null>>,
): Record<string, boolean> {
  const merged: Record<string, boolean> = { ...current };
  for (const [permission, on] of Object.entries(patch)) {
    if (on === null) delete merged[permission];
    else merged[permission] = on;
  }
  return merged;
}

/** `changes` without the fields left out, so the update writes only those. */
function withoutUndefined<T extends object>(changes: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/**
 * Refuses a role name that reads as `@everyone` (#4191) or `@here`
 * (2026-11-12): a second role folding to `@everyone` would make every
 * `@everyone` ambiguous, which reaches nobody, and `@here` is the members
 * online, never a role.
 */
function assertNotReservedMentionName(name: string | undefined): void {
  const reserved = name === undefined ? null : reservedMentionName(name);
  if (name !== undefined && reserved !== null) {
    throw new ConflictException({
      code: 'role.everyone_name',
      message: `"${name.trim()}" is what @${reserved} reads as. Pick another name.`,
    });
  }
}
