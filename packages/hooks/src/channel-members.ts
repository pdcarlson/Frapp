import { EVERYONE_MEMBER_LIST_HEADING } from "@repo/validation";

/**
 * The order Chat's member list draws a channel's readers in (#3536), shared
 * so the web column and the mobile sheet cannot drift apart.
 *
 * Grouped by tier, the chapter's tiers top down (Cabinet, then Committee
 * Chairs, and so on), each member under the highest tier any of their roles
 * is in (Paul, 2026-11-20). Inside a tier, by title: `role_rank` from
 * `GET /v1/channels/{id}/members` is where the member's highest-ranked role
 * sits in the chapter's roles (`@repo/validation` `compareRolesByRank`), so
 * the President leads Cabinet and the Treasurer follows. Then name,
 * case-insensitively.
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

/** A row the list can group: ranked, and carrying the tier it files under. */
export interface GroupableChannelMember extends RankedChannelMember {
  /** The highest tier any of the member's roles is in, or `null` for none. */
  tierId: string | null;
  /** That tier's name, the group heading. */
  tierName: string | null;
  /** That tier's position, 1 for the top tier. */
  tierRank: number | null;
}

export interface ChannelMemberGroup<T extends GroupableChannelMember> {
  /** The tier id, or {@link OUTSIDE_TIERS_GROUP_KEY}. */
  key: string;
  label: string;
  rows: T[];
}

/** The group for readers with no role in any tier, last in the list. */
export const OUTSIDE_TIERS_GROUP_KEY = "outside";

/** That group's heading when a tier is already called "Members". */
export const OUTSIDE_TIERS_FALLBACK_LABEL = "Everyone else";

/**
 * Chat's member list, a group per tier in tier order and members by title
 * inside each, then everyone outside the tiers under "Members"
 * (`EVERYONE_MEMBER_LIST_HEADING`).
 *
 * Grouped by tier rather than by presence because tiers are known with the
 * first read: a list that regroups into Online and Offline once presence
 * arrives moves every name (`principles.md` P4.4). An offline member keeps
 * their place; presence changes a dot, never a row's place.
 *
 * Grouped by tier rather than by each member's role because a chapter's
 * Cabinet is one block of people, President first, as the chapter's own
 * Discord lists them; one heading per office drew a heading over every
 * officer. The office itself is the row's title line.
 *
 * An API older than the tier fields sends no `tier_id` at all; then the rows
 * come back as one list under "Members", ranked as before.
 */
export function groupChannelMembersByTier<T extends GroupableChannelMember>(
  rows: readonly T[],
  /** The unfiltered list, so a search can't change a group's heading. */
  allRows: readonly T[] = rows,
): ChannelMemberGroup<T>[] {
  if (!rows.length) return [];
  const groups = new Map<string, ChannelMemberGroup<T> & { rank: number }>();
  for (const row of rows) {
    const key = row.tierId ?? OUTSIDE_TIERS_GROUP_KEY;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: row.tierId
          ? row.tierName || EVERYONE_MEMBER_LIST_HEADING
          : EVERYONE_MEMBER_LIST_HEADING,
        rows: [],
        rank: row.tierId
          ? (row.tierRank ?? Number.POSITIVE_INFINITY)
          : Number.POSITIVE_INFINITY,
      };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  // A tier the chapter itself calls "Members" keeps that heading, and the
  // readers outside every tier read as everyone else beside it.
  const outside = groups.get(OUTSIDE_TIERS_GROUP_KEY);
  const heading = foldForSearch(EVERYONE_MEMBER_LIST_HEADING);
  if (
    outside &&
    allRows.some(
      (row) =>
        Boolean(row.tierId) &&
        foldForSearch(row.tierName || EVERYONE_MEMBER_LIST_HEADING) === heading,
    )
  ) {
    outside.label = OUTSIDE_TIERS_FALLBACK_LABEL;
  }
  return [...groups.values()]
    .sort((a, b) => {
      if (a.key === OUTSIDE_TIERS_GROUP_KEY) return 1;
      if (b.key === OUTSIDE_TIERS_GROUP_KEY) return -1;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    })
    .map(({ key, label, rows: inGroup }) => ({
      key,
      label,
      rows: inGroup.sort(compareChannelMembers),
    }));
}

/**
 * The title line under a member's name: their title, unless it only repeats
 * the group heading (a "New Member" under "New members", a tier holding one
 * role of its own name). `null` when there is nothing to add.
 */
export function channelMemberTitle(
  row: { title: string | null },
  groupLabel: string,
): string | null {
  const title = row.title?.trim();
  if (!title) return null;
  const heading = foldForSearch(groupLabel).trim();
  const own = foldForSearch(title);
  if (own === heading || `${own}s` === heading) return null;
  return title;
}

/**
 * Past this many readers the list gets a search field. A DM or a small
 * committee channel fits on screen and needs no box; #general in a 66-member
 * chapter does not (principles.md P5.2).
 */
export const MEMBER_SEARCH_THRESHOLD = 12;

/**
 * Where a name splits into words: spaces, hyphens, apostrophes, periods.
 * Shared with the Direct messages people search (`dm-search.ts`), so a name
 * splits the same way in both.
 */
export const NAME_SEPARATORS = /[\s\-'\u2019.]+/;

/**
 * Lowercased, accents dropped, so "jose" finds "José". Shared with the Direct
 * messages people search, so a name folds the same way in both.
 */
export function foldForSearch(text: string): string {
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
