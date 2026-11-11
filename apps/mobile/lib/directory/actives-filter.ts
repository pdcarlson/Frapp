/**
 * The Directory's Actives filters (#3971): role, graduation year, pledge class
 * and status, the four web's Directory toolbar carries
 * (`apps/web/components/members/members-directory.tsx`), applied to the same
 * `GET /v1/members` rows by the same rules, so a filter reads the same on
 * both.
 *
 * Client-side, as web's are: the Actives tab already holds the whole list, and
 * `GET /v1/members` takes no filter params.
 */
import { matchesWordStarts, normalizeWords } from "@repo/hooks/fuzzy-match";
import { roleColorOrNull } from "@repo/validation";
import { num, records, str } from "../more/narrow";

export type ActivesStatus = "active" | "pending";

export interface ActivesFilter {
  roleId: string | null;
  graduationYear: number | null;
  pledgeClassId: string | null;
  status: ActivesStatus | null;
}

export const NO_ACTIVES_FILTER: ActivesFilter = {
  roleId: null,
  graduationYear: null,
  pledgeClassId: null,
  status: null,
};

/** Web's Status options and words: onboarding finished, or not yet. */
export const STATUS_OPTIONS: readonly {
  value: ActivesStatus;
  label: string;
}[] = [
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
];

export interface FilterRole {
  id: string;
  name: string;
  color: string | null;
}

/**
 * The roles an active can be narrowed by, in the order `GET /v1/roles` returns
 * them (web's order). The Alumni system role is left out: nobody on the
 * Actives tab holds it, as web leaves it out of its role filter outside a
 * search. Read defensively, since the endpoint declares no response schema.
 */
export function parseFilterRoles(rolesData: unknown): FilterRole[] {
  return records(rolesData).flatMap((row) => {
    const id = str(row, "id");
    const name = str(row, "name");
    if (!id || !name || row.system_key === "ALUMNI") return [];
    // Palette colors only, as every other role-color path paints them
    // (`roleColorOrNull`): a legacy or free-typed value paints no dot.
    return [{ id, name, color: roleColorOrNull(row.color) }];
  });
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
    years: readonly number[];
    classIds: ReadonlySet<string>;
  },
): ActivesFilter {
  return {
    roleId:
      filter.roleId !== null && known.roleIds.has(filter.roleId)
        ? filter.roleId
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
): Record<string, unknown>[] {
  return actives.filter((row) => {
    if (filter.roleId !== null) {
      const roleIds = Array.isArray(row.role_ids) ? row.role_ids : [];
      if (!roleIds.includes(filter.roleId)) return false;
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
