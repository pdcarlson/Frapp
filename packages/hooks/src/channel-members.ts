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

/** A row the list can group: ranked, and carrying the role it ranks by. */
export interface GroupableChannelMember extends RankedChannelMember {
  /** The member's highest role's id, or `null` when they hold none. */
  roleId: string | null;
  /** That role's name, the group heading. */
  roleName: string | null;
}

export interface ChannelMemberRoleGroup<T extends GroupableChannelMember> {
  /** The role id, `"none"` for members with no role, `"all"` for one ungrouped list. */
  key: string;
  label: string;
  rows: T[];
}

/** The heading over readers who hold no role at all. */
export const NO_ROLE_GROUP_LABEL = "No role";

/**
 * Chat's member list, grouped by each reader's highest role (Discord's
 * hoisted roles), groups in role order and names A to Z inside each.
 *
 * Grouped by role rather than by presence because role is known with the
 * first read: a list that regroups into Online and Offline once presence
 * arrives moves every name (`principles.md` P4.4). Presence changes a dot,
 * never a row's place.
 *
 * At real scale the groups stay few: a chapter's system roles (President,
 * Treasurer, Vice President, Secretary, Member, New Member, Alumni) rank above
 * any imported Discord role, so a 109-role chapter still draws about seven
 * headings. Readers with no role come last under {@link NO_ROLE_GROUP_LABEL}.
 *
 * An API older than the role fields sends no `role_id` at all; then the rows
 * come back as one "Members" list in the old order rather than every member
 * landing under "No role".
 */
export function groupChannelMembersByRole<T extends GroupableChannelMember>(
  rows: readonly T[],
): ChannelMemberRoleGroup<T>[] {
  if (!rows.length) return [];
  if (
    rows.every((row) => row.roleId == null) &&
    rows.some((row) => row.roleRank != null)
  ) {
    return [
      {
        key: "all",
        label: "Members",
        rows: [...rows].sort(compareChannelMembers),
      },
    ];
  }
  const groups = new Map<
    string,
    ChannelMemberRoleGroup<T> & { rank: number }
  >();
  for (const row of rows) {
    const key = row.roleId ?? "none";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: row.roleId ? (row.roleName ?? "") : NO_ROLE_GROUP_LABEL,
        rows: [],
        rank: row.roleId
          ? (row.roleRank ?? Number.POSITIVE_INFINITY)
          : Number.POSITIVE_INFINITY,
      };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  return [...groups.values()]
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.key === "none") return 1;
      if (b.key === "none") return -1;
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    })
    .map(({ key, label, rows: inGroup }) => ({
      key,
      label,
      rows: inGroup.sort(compareChannelMembers),
    }));
}

/**
 * Past this many readers the list gets a search field. A DM or a small
 * committee channel fits on screen and needs no box; #general in a 66-member
 * chapter does not (principles.md P5.2).
 */
export const MEMBER_SEARCH_THRESHOLD = 12;

/** Where a name splits into words: spaces, hyphens, apostrophes, periods. */
const NAME_SEPARATORS = /[\s\-'\u2019.]+/;

/** Lowercased, accents dropped, so "jose" finds "José". */
function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * The member list's search: every word of the query must start a word of the
 * name ("ja sm" finds "Jake Smith"), ignoring case and accents. An empty
 * query keeps every row.
 */
export function filterChannelMembers<T extends { name: string }>(
  rows: readonly T[],
  query: string,
): T[] {
  // Split the query on the name's own separators, so a typed "O'Brien" or
  // "Mary-Kate" matches the words the name was split into.
  const terms = foldForSearch(query).split(NAME_SEPARATORS).filter(Boolean);
  if (!terms.length) return [...rows];
  return rows.filter((row) => {
    const words = foldForSearch(row.name)
      .split(NAME_SEPARATORS)
      .filter(Boolean);
    return terms.every((term) => words.some((word) => word.startsWith(term)));
  });
}
