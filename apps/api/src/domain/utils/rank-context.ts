/**
 * Who is acting and the chapter's roles and tiers, for the rank rules
 * (#4071), built from rows the caller already read. `RbacService.getRankContext`
 * reads them for most callers; a service that can't depend on `RbacService`
 * (`ChapterConfigService`, which `RbacModule` imports) reads them itself and
 * builds the same context here, so the two can't drift.
 */
import type { Member } from '#domain/entities/member.entity';
import type { Role, RoleTier } from '#domain/entities/role.entity';
import { WILDCARD } from '#domain/constants/permissions';
import { flattenPermissionSets } from '#domain/utils/permissions';
import {
  holderRank,
  tierPositions,
  type ActorReach,
} from '#domain/utils/role-rank';

export interface RankContext {
  reach: ActorReach;
  roles: Role[];
  tiers: RoleTier[];
  positions: ReadonlyMap<string, number>;
}

/**
 * The context for `member` in `chapterId`. `roles` and `tiers` are re-scoped
 * to the chapter. A caller with no membership, or whose roles are all gone,
 * ranks outside the tiers and holds nothing, so every rank rule refuses them.
 */
export function rankContextFrom(
  chapterId: string,
  member: Pick<Member, 'id' | 'chapter_id' | 'role_ids'> | null,
  allRoles: readonly Role[],
  allTiers: readonly RoleTier[],
): RankContext {
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
 * How high `member` ranks among the context's roles: the highest of the live
 * roles they hold (`role_ids` compared lower-cased, stale ids ignored, as for
 * the actor above). For the rules that let an officer act only on members
 * ranked below them (`canReach`).
 */
export function memberRankIn(
  context: Pick<RankContext, 'roles' | 'positions'>,
  member: Pick<Member, 'role_ids'>,
): number {
  const roleById = new Map(
    context.roles.map((role) => [role.id.toLowerCase(), role] as const),
  );
  const held = member.role_ids
    .map((id) => roleById.get(id.toLowerCase()))
    .filter((role): role is Role => role !== undefined);
  return holderRank(held, context.positions);
}
