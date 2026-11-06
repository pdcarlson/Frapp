/**
 * The order Chat's member list draws a channel's readers in (#3536), shared
 * so the web column and the mobile sheet cannot drift apart.
 *
 * Role rank first: `role_rank` from `GET /v1/channels/{id}/members` is the
 * member's highest role's `display_order`, so a lower number ranks higher,
 * and a member with no role (`null`) comes last. Officers lead as they do on
 * the Roles page. Then name, case-insensitively.
 */
export interface RankedChannelMember {
  name: string;
  roleRank: number | null;
}

export function compareChannelMembers(
  a: RankedChannelMember,
  b: RankedChannelMember,
): number {
  const rankA = a.roleRank ?? Number.POSITIVE_INFINITY;
  const rankB = b.roleRank ?? Number.POSITIVE_INFINITY;
  if (rankA !== rankB) return rankA - rankB;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}
