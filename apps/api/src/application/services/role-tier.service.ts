import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ROLE_TIER_REPOSITORY } from '#domain/repositories/role-tier.repository.interface';
import type { IRoleTierRepository } from '#domain/repositories/role-tier.repository.interface';
import { RoleTier } from '#domain/entities/role.entity';
import { WILDCARD } from '#domain/constants/permissions';
import { addedPermissions, canReach } from '#domain/utils/role-rank';
import { ROLE_TIER_POSITION_MAX } from '#domain/constants/field-limits';
import {
  assertPermissionsHeld,
  RANK_REFUSAL,
  RbacService,
} from './rbac.service';
import { ChapterAuditLogService } from './chapter-audit-log.service';

/** `target_type` of a tier's audit rows. */
const AUDIT_TARGET_TYPE = 'role_tier';

/**
 * A chapter's tiers of roles (#4071): add, rename, set permissions, reorder
 * and delete, each behind `roles:manage` (the controller) and the rank rules
 * (here).
 *
 * The rank rules, for a caller who does not hold `*`:
 *
 * - Only a tier ranked below the caller's own may be renamed, given
 *   permissions or deleted. A chair cannot touch the chairs' tier.
 * - A new tier goes in at the bottom, below everyone's.
 * - A reorder must leave every tier from the top down to the caller's own
 *   where it is, so nobody lifts a tier to or above theirs.
 * - A tier may only gain permissions the caller holds, and never `*`.
 *
 * Every change writes a `chapter_audit_log` row mirrored to `#chapter-audit`,
 * as a role change does.
 */
@Injectable()
export class RoleTierService {
  constructor(
    @Inject(ROLE_TIER_REPOSITORY)
    private readonly tierRepo: IRoleTierRepository,
    private readonly rbac: RbacService,
    private readonly audit: ChapterAuditLogService,
  ) {}

  /** The chapter's tiers, highest first. */
  async list(chapterId: string): Promise<RoleTier[]> {
    return this.tierRepo.findByChapter(chapterId);
  }

  async create(
    chapterId: string,
    actorUserId: string,
    data: { name: string; permissions?: string[] },
  ): Promise<RoleTier> {
    const name = tierName(data.name);
    const permissions = tierPermissions(data.permissions ?? []);
    const { reach, tiers } = await this.rbac.getRankContext(
      chapterId,
      actorUserId,
    );
    // A caller with no tier of their own ranks outside the tiers, and a new
    // tier would rank above them.
    if (!reach.wildcard && !Number.isFinite(reach.rank)) {
      throw new ForbiddenException(RANK_REFUSAL);
    }
    assertPermissionsHeld(reach, permissions);
    const position = Math.max(0, ...tiers.map((tier) => tier.position)) + 1;
    if (position > ROLE_TIER_POSITION_MAX) {
      throw new BadRequestException(
        `A chapter can have at most ${ROLE_TIER_POSITION_MAX} tiers`,
      );
    }

    const tier = await this.tierRepo.create({
      chapter_id: chapterId,
      name,
      position,
      permissions,
    });
    if (!tier) {
      throw new ConflictException(
        'A tier with that name already exists, or another officer just added one. Reload and try again.',
      );
    }
    await this.audit.record({
      chapterId,
      actorUserId,
      action: 'role_tier_created',
      targetType: AUDIT_TARGET_TYPE,
      targetId: tier.id,
      diff: { tier: { from: null, to: tier } },
    });
    return tier;
  }

  /**
   * Rename a tier, set its permissions, or both. A new list rewrites every
   * role in the tier in the same transaction (the database's tier trigger),
   * each with its own overrides applied.
   */
  async update(
    tierId: string,
    chapterId: string,
    actorUserId: string,
    data: { name?: string; permissions?: string[] },
  ): Promise<RoleTier> {
    const changes: { name?: string; permissions?: string[] } = {};
    if (data.name !== undefined) changes.name = tierName(data.name);
    if (data.permissions !== undefined) {
      changes.permissions = tierPermissions(data.permissions);
    }

    const { reach, tiers } = await this.rbac.getRankContext(
      chapterId,
      actorUserId,
    );
    const tier = tiers.find((candidate) => candidate.id === tierId);
    if (!tier) throw new NotFoundException('Tier not found');
    if (!canReach(reach, tier.position)) {
      throw new ForbiddenException(RANK_REFUSAL);
    }
    if (changes.permissions) {
      assertPermissionsHeld(
        reach,
        addedPermissions(tier.permissions, changes.permissions),
      );
    }
    if (Object.keys(changes).length === 0) return tier;

    const updated = await this.tierRepo.update(tierId, chapterId, changes);
    if (updated === null) {
      throw new ConflictException('A tier with that name already exists');
    }
    if (updated === undefined) throw new NotFoundException('Tier not found');

    const diff = diffTier(tier, updated);
    if (Object.keys(diff).length > 0) {
      await this.audit.record({
        chapterId,
        actorUserId,
        action: 'role_tier_updated',
        targetType: AUDIT_TARGET_TYPE,
        targetId: tierId,
        diff,
      });
    }
    return updated;
  }

  /**
   * Put the chapter's tiers in a new order. `tierIds` names every tier once,
   * highest first. The tiers from the top down to the caller's own are fixed
   * for them; the database re-checks that, with the tiers locked, so a
   * reorder by someone else in between is refused as stale rather than
   * applied over.
   */
  async reorder(
    chapterId: string,
    actorUserId: string,
    tierIds: string[],
  ): Promise<RoleTier[]> {
    const { reach, tiers } = await this.rbac.getRankContext(
      chapterId,
      actorUserId,
    );
    const current = tiers.map((tier) => tier.id);
    const asked = new Set(tierIds);
    if (
      tierIds.length !== current.length ||
      asked.size !== current.length ||
      current.some((id) => !asked.has(id))
    ) {
      throw new BadRequestException(
        "tier_ids must list every one of the chapter's tiers once",
      );
    }
    const fixed = reach.wildcard
      ? []
      : tiers
          .filter((tier) => !canReach(reach, tier.position))
          .map((t) => t.id);
    // `fixed` is a prefix of `current`: positions ascend, and `canReach` is
    // false exactly for the tiers at or above the caller.
    if (fixed.some((id, index) => tierIds[index] !== id)) {
      throw new ForbiddenException(RANK_REFUSAL);
    }
    if (current.every((id, index) => tierIds[index] === id)) return tiers;

    const reordered = await this.tierRepo.reorder(chapterId, tierIds, fixed);
    if (reordered === 'stale') {
      throw new ConflictException(
        "The chapter's tiers changed since this page loaded. Reload and try again.",
      );
    }
    await this.audit.record({
      chapterId,
      actorUserId,
      action: 'role_tiers_reordered',
      targetType: AUDIT_TARGET_TYPE,
      targetId: null,
      diff: {
        order: {
          from: tiers.map((tier) => tier.name),
          to: reordered.map((tier) => tier.name),
        },
      },
    });
    return reordered;
  }

  /** Delete an empty tier ranked below the caller. */
  async delete(
    tierId: string,
    chapterId: string,
    actorUserId: string,
  ): Promise<void> {
    const { reach, tiers, roles } = await this.rbac.getRankContext(
      chapterId,
      actorUserId,
    );
    const tier = tiers.find((candidate) => candidate.id === tierId);
    if (!tier) throw new NotFoundException('Tier not found');
    if (!canReach(reach, tier.position)) {
      throw new ForbiddenException(RANK_REFUSAL);
    }
    const hasRoles = roles.some((role) => role.tier_id === tierId);
    const result = hasRoles
      ? 'has_roles'
      : await this.tierRepo.delete(tierId, chapterId);
    if (result === 'missing') throw new NotFoundException('Tier not found');
    if (result === 'has_roles') {
      throw new ConflictException(
        'Move the roles in this tier to another tier before deleting it',
      );
    }
    await this.audit.record({
      chapterId,
      actorUserId,
      action: 'role_tier_deleted',
      targetType: AUDIT_TARGET_TYPE,
      targetId: tierId,
      diff: { tier: { from: tier, to: null } },
    });
  }
}

/** A trimmed tier name, or 400 for one that is blank. */
function tierName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new BadRequestException('A tier needs a name');
  }
  return trimmed;
}

/** A tier's list, distinct and sorted; 400 for the wildcard. */
function tierPermissions(permissions: readonly string[]): string[] {
  if (permissions.includes(WILDCARD)) {
    throw new BadRequestException(
      'A tier cannot carry the wildcard (*) permission; it moves only through presidency transfer',
    );
  }
  return [...new Set(permissions)].sort();
}

/**
 * The audited difference: the name as from/to, the permissions as what was
 * added and removed, as a role's are (#2599).
 */
function diffTier(before: RoleTier, after: RoleTier): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  if (before.name !== after.name) {
    diff.name = { from: before.name, to: after.name };
  }
  const added = addedPermissions(before.permissions, after.permissions);
  const removed = addedPermissions(after.permissions, before.permissions);
  if (added.length > 0 || removed.length > 0) {
    diff.permissions = { added, removed };
  }
  return diff;
}
