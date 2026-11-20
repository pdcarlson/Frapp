/**
 * Which of a member's roles ranks highest, shared by the API and both apps so
 * every surface names the same title and draws the same order (Paul,
 * 2026-11-20: a member's title is their highest-ranked position, and the
 * member list runs from the top tier down, President first).
 *
 * A role ranks by, in turn:
 *
 * 1. Holding the wildcard `*` (the President's role), above everything,
 *    wherever it sits, as the API's rank rules have it (`role-rank.ts`).
 * 2. Its tier's `position` (1 is highest). A role outside every tier, or
 *    naming a tier the chapter no longer has, ranks below every tier.
 * 3. Its own `display_order` inside the tier (the order the Roles page lists
 *    a tier's roles in).
 * 4. Its name, then its id, so two calls always agree.
 *
 * `display_order` alone is not a rank: roles imported from Discord or made
 * outside the tiers carry `0`, which used to put a "First Floor" above the
 * President and name it as the member's title.
 */

/** The fields a role is ranked by. */
export interface RankableRole {
  id: string;
  name: string;
  display_order: number;
  tier_id?: string | null;
  permissions?: readonly string[] | null;
}

/** A tier's position by id, from the chapter's tiers. */
export type TierPositions = ReadonlyMap<string, number>;

export function tierPositionsOf(
  tiers: readonly { id: string; position: number }[],
): TierPositions {
  return new Map(tiers.map((tier) => [tier.id, tier.position]));
}

/** A role's tier position, `Infinity` outside the tiers; the wildcard ranks above all. */
function tierRankOf(role: RankableRole, positions: TierPositions): number {
  if (role.permissions?.includes("*")) return Number.NEGATIVE_INFINITY;
  if (!role.tier_id) return Number.POSITIVE_INFINITY;
  return positions.get(role.tier_id) ?? Number.POSITIVE_INFINITY;
}

/** Negative when `a` ranks above `b`. */
export function compareRolesByRank(
  a: RankableRole,
  b: RankableRole,
  positions: TierPositions,
): number {
  const tierA = tierRankOf(a, positions);
  const tierB = tierRankOf(b, positions);
  if (tierA !== tierB) return tierA < tierB ? -1 : 1;
  if (a.display_order !== b.display_order) {
    return a.display_order - b.display_order;
  }
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The chapter's roles, highest first. */
export function sortRolesByRank<T extends RankableRole>(
  roles: readonly T[],
  positions: TierPositions,
): T[] {
  return [...roles].sort((a, b) => compareRolesByRank(a, b, positions));
}

/** The highest-ranked of `roles`, or `null` when there are none. */
export function highestRankedRole<T extends RankableRole>(
  roles: readonly T[],
  positions: TierPositions,
): T | null {
  let best: T | null = null;
  for (const role of roles) {
    if (!best || compareRolesByRank(role, best, positions) < 0) best = role;
  }
  return best;
}
