/**
 * Helpers for resolving leaderboard rows to member display names in the
 * dashboard activity feed. Leaderboard totals are keyed by auth user id, while
 * member rows also carry a distinct membership id — index both so lookups
 * stay correct even if a payload field is mis-keyed or camelCased.
 */

export type ActivityFeedLeaderboardEntry = {
  user_id?: string;
  total?: number;
  /** Alternate shapes from proxies or older payloads */
  userId?: string;
  member_id?: string;
};

export type ActivityFeedMember = {
  id?: string;
  user_id?: string;
  display_name?: string | null;
};

function nonEmptyTrimmed(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t.length ? t : undefined;
}

/** Prefer user id (matches point_transactions / API); fall back to alternate keys. */
export function leaderboardSubjectId(
  entry: ActivityFeedLeaderboardEntry,
): string | undefined {
  return (
    nonEmptyTrimmed(entry.user_id) ??
    nonEmptyTrimmed(entry.userId) ??
    nonEmptyTrimmed(entry.member_id)
  );
}

/** Map both membership id and user id to the same display name when both exist. */
export function buildMemberDisplayNameMap(
  members: ActivityFeedMember[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const member of members) {
    const name = nonEmptyTrimmed(member.display_name);
    if (!name) continue;
    const userId = nonEmptyTrimmed(member.user_id);
    const memberId = nonEmptyTrimmed(member.id);
    if (userId) map.set(userId, name);
    if (memberId && memberId !== userId) map.set(memberId, name);
  }
  return map;
}
