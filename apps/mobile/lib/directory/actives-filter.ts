/**
 * The Directory's Actives filters (#3971): role, group, graduation year,
 * pledge class and status, the ones web's Directory toolbar carries
 * (`apps/web/components/members/members-directory.tsx`), applied to the same
 * `GET /v1/members` rows by the same rules, so a filter reads the same on
 * both.
 *
 * Client-side, as web's are: the Actives tab already holds the whole list, and
 * `GET /v1/members` takes no filter params.
 */
import { matchesWordStarts, normalizeWords } from "@repo/hooks/fuzzy-match";
import type { ChapterRole } from "@repo/hooks/chapter-roles";
import { matchesRoleFilter } from "@repo/hooks/member-assignments";
import {
  matchesPhoneReachFilter,
  type PhoneReach,
  type PhoneReachFilter,
} from "@repo/validation";
import { num, str } from "../more/narrow";

export type ActivesStatus = "active" | "pending";

export interface ActivesFilter {
  /** A role id, or `NO_BASE_ROLE_FILTER` for members holding no base role. */
  roleId: string | null;
  /** A group the member is in (Paul, 2026-11-19), as web's Group chip. */
  groupId: string | null;
  graduationYear: number | null;
  pledgeClassId: string | null;
  status: ActivesStatus | null;
  /**
   * Whether Frapp's notifications reach the member's phone (web's "Phone app"
   * chip). Offered only to officers the server sends the whole chapter's
   * reach to.
   */
  phoneReach: PhoneReachFilter | null;
}

export const NO_ACTIVES_FILTER: ActivesFilter = {
  roleId: null,
  groupId: null,
  graduationYear: null,
  pledgeClassId: null,
  status: null,
  phoneReach: null,
};

/** Web's Status options and words: onboarding finished, or not yet. */
export const STATUS_OPTIONS: readonly {
  value: ActivesStatus;
  label: string;
}[] = [
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
];

export type FilterRole = Pick<ChapterRole, "id" | "name" | "color">;

/**
 * The roles an active can be narrowed by, in the order `GET /v1/roles` returns
 * them (web's order), from `parseChapterRoles` (`@repo/hooks/chapter-roles`).
 * The Alumni system role is left out: nobody on the Actives tab holds it, as
 * web leaves it out of its role filter outside a search. Everyone (#4191): no
 * list offers it.
 */
export function activesFilterRoles(
  roles: readonly ChapterRole[],
): FilterRole[] {
  return roles
    .filter((role) => role.system_key !== "ALUMNI" && !role.everyone)
    .map(({ id, name, color }) => ({ id, name, color }));
}

/**
 * The role list for a typed query, matched by `matchesWordStarts`, the rule
 * web's searchable role chip uses: every word typed starts a word of the name,
 * case and accents ignored, so "rec" finds "Rush/Recruitment Chair".
 */
export function searchFilterRoles(
  roles: readonly FilterRole[],
  query: string,
): FilterRole[] {
  return roles.filter((role) => matchesWordStarts(role.name, query));
}

/**
 * Whether a typed role query narrows anything. Punctuation alone doesn't (the
 * matcher drops it), so "(" on the way to "(Exec)" still shows Any role.
 */
export function hasRoleQuery(query: string): boolean {
  return normalizeWords(query).length > 0;
}

/** The actives' graduation years, newest first, as web lists them. */
export function graduationYearOptions(
  actives: readonly Record<string, unknown>[],
): number[] {
  const years = new Set<number>();
  for (const row of actives) {
    const year = num(row, "graduation_year");
    if (year !== null) years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}

/**
 * The filter with any pick that no longer exists dropped (a role deleted, the
 * last member of a year graduated, the class list unread), so a stale pick
 * reads as unpicked instead of emptying the list for a reason nobody can see.
 * Web does the same with its `effective*` values.
 */
export function effectiveActivesFilter(
  filter: ActivesFilter,
  known: {
    roleIds: ReadonlySet<string>;
    /** Groups with at least one member, the ones the sheet offers. */
    groupIds?: ReadonlySet<string>;
    years: readonly number[];
    classIds: ReadonlySet<string>;
    /** Whether the Phone app filter is offered (officers only). */
    phoneReach?: boolean;
  },
): ActivesFilter {
  return {
    roleId:
      filter.roleId !== null && known.roleIds.has(filter.roleId)
        ? filter.roleId
        : null,
    groupId:
      filter.groupId !== null && known.groupIds?.has(filter.groupId)
        ? filter.groupId
        : null,
    graduationYear:
      filter.graduationYear !== null &&
      known.years.includes(filter.graduationYear)
        ? filter.graduationYear
        : null,
    pledgeClassId:
      filter.pledgeClassId !== null && known.classIds.has(filter.pledgeClassId)
        ? filter.pledgeClassId
        : null,
    status: filter.status,
    phoneReach: known.phoneReach ? filter.phoneReach : null,
  };
}

/** How many filters are set, for the Filters chip's count. */
export function countActivesFilters(filter: ActivesFilter): number {
  return Object.values(filter).filter((value) => value !== null).length;
}

/** The actives that pass every set filter. */
export function filterActives(
  actives: readonly Record<string, unknown>[],
  filter: ActivesFilter,
  /** Each member's phone reach by `user_id`, for the Phone app filter. */
  reachByUserId?: ReadonlyMap<string, PhoneReach>,
  /** The `user_id`s in the picked group, for the Group filter. */
  groupMemberIds?: ReadonlySet<string>,
  /** The chapter's roles, for the No base role pick (#5802). */
  chapterRoles: readonly Pick<ChapterRole, "id" | "system_key">[] = [],
): Record<string, unknown>[] {
  return actives.filter((row) => {
    if (filter.groupId !== null) {
      const userId = str(row, "user_id");
      if (!userId || !groupMemberIds?.has(userId)) return false;
    }
    if (filter.phoneReach !== null) {
      const userId = str(row, "user_id");
      const reach = userId ? reachByUserId?.get(userId) : undefined;
      if (!matchesPhoneReachFilter(reach, filter.phoneReach)) return false;
    }
    if (filter.roleId !== null) {
      const roleIds = Array.isArray(row.role_ids)
        ? row.role_ids.filter((id): id is string => typeof id === "string")
        : [];
      if (!matchesRoleFilter(chapterRoles, roleIds, filter.roleId)) {
        return false;
      }
    }
    if (
      filter.graduationYear !== null &&
      num(row, "graduation_year") !== filter.graduationYear
    ) {
      return false;
    }
    if (
      filter.pledgeClassId !== null &&
      str(row, "pledge_class_id") !== filter.pledgeClassId
    ) {
      return false;
    }
    if (filter.status !== null) {
      const onboarded = row.has_completed_onboarding === true;
      if (filter.status === "active" ? !onboarded : onboarded) return false;
    }
    return true;
  });
}
