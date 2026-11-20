import {
  isEveryoneRole,
  roleColorOrNull,
  sortRolesByRank,
  tierPositionsOf,
} from "@repo/validation";
import { matchesWordStarts, normalizeWords } from "./fuzzy-match";
import type { ChapterGroup } from "./use-groups";
import {
  isWildcardRole,
  reachesRole,
  type Reach,
  type TierRow,
  type TieredRole,
} from "./role-tiers";

/*
 * What a member's profile offers under "+ Add" (Paul, 2026-11-19: roles and
 * groups are set from one place, and from the person, not only from the
 * role's or group's own page). One list on both apps: the roles under their
 * tiers, then the chapter's own groups, each a row the viewer ticks to give
 * or take away. Each tick saves at once.
 *
 * Roles follow the rank rules (`role-tiers.ts`, #4071) so a row the API
 * would refuse is shown, disabled, with the reason, rather than hidden: a
 * chair sees the officer roles exist and why they can't hand them out. The
 * API stays the authority, and a refusal it sends still lands as a toast.
 *
 * Groups grant nothing, so any `groups:manage` holder may tick any of the
 * chapter's own groups. A pledge class's or class year's group follows the
 * member's own details and is never offered. A group a channel's access list
 * names also needs `channels:manage`; the client can't see which lists name
 * which groups, so that refusal comes back from the API.
 */

/** Why a role row is shown but can't be ticked. */
export const ASSIGN_CAPTIONS = {
  presidency: "Changes with Transfer presidency",
  checking: "Checking what your role can give",
  ranksAbove: "Ranks at or above yours",
  noRoles: "Your role can't give roles",
  noGroups: "Your role can't change groups",
} as const;

/**
 * The words both apps use when a role or group change from a member goes
 * wrong or needs a yes, so the web card and the phone sheet say the same.
 * Each tap removes one role, so the confirm names it.
 */
export const ASSIGN_COPY = {
  accessTitle: (name: string) => `Take away ${name}'s access?`,
  accessBody: (name: string) =>
    `Without this role, ${name} can't open chat, the member list or events.`,
  accessConfirm: (roleName: string) => `Remove ${roleName}`,
  rolesFailed: "Couldn't save roles",
  groupAddFailed: "Couldn't add to that group",
  groupRemoveFailed: "Couldn't take out of that group",
} as const;

/** What an automatic group follows, said beside it on both apps. */
export function groupFollowsLabel(
  group: Pick<ChapterGroup, "kind">,
): string | null {
  if (group.kind === "pledge_class") return "Follows pledge class";
  if (group.kind === "class_year") return "Follows graduation year";
  return null;
}

export type AssignmentRow = {
  kind: "role" | "group";
  id: string;
  name: string;
  /** A palette color, or `null` for none. */
  color: string | null;
  /** Whether the member has it now. */
  held: boolean;
  /** Why it can't be ticked, or `null` when it can. */
  disabledReason: string | null;
};

export type AssignmentSection = {
  /** Stable key: a tier id, `outside`, or `groups`. */
  key: string;
  title: string;
  rows: AssignmentRow[];
};

export type AssignmentInputs = {
  roles: readonly TieredRole[];
  tiers: readonly TierRow[];
  groups: readonly ChapterGroup[];
  reach: Reach;
  canManageRoles: boolean;
  canManageGroups: boolean;
  /** The member's role ids now. */
  heldRoleIds: readonly string[];
  /** The member's `users.id`, which group membership is keyed by. */
  userId: string;
  /** The chapter's plural word for roles outside the tiers' heading. */
  outsideTitle?: string;
  /** Search text; empty shows everything. */
  query?: string;
};

function roleReason(role: TieredRole, inputs: AssignmentInputs): string | null {
  if (isWildcardRole(role)) return ASSIGN_CAPTIONS.presidency;
  if (!inputs.canManageRoles) return ASSIGN_CAPTIONS.noRoles;
  if (!inputs.reach.known) return ASSIGN_CAPTIONS.checking;
  if (!reachesRole(inputs.reach, role, inputs.tiers)) {
    return ASSIGN_CAPTIONS.ranksAbove;
  }
  return null;
}

/**
 * The "+ Add" list for one member: a section per tier (highest first) with
 * its roles, then roles outside the tiers, then the chapter's own groups.
 * The Everyone role is never a row (#4191). Sections a search empties are
 * left out.
 */
export function memberAssignmentSections(
  inputs: AssignmentInputs,
): AssignmentSection[] {
  // Every word typed matches the start of a word, ignoring case and accents,
  // as every other role search does (`fuzzy-match.ts`).
  const query = inputs.query ?? "";
  const searching = normalizeWords(query).length > 0;
  const matches = (name: string) =>
    !searching || matchesWordStarts(name, query);
  const held = new Set(inputs.heldRoleIds);
  const byOrder = (a: TieredRole, b: TieredRole) =>
    a.display_order - b.display_order || a.name.localeCompare(b.name);
  const assignable = inputs.roles.filter(
    (role) => !isEveryoneRole(role) && matches(role.name),
  );
  const roleRow = (role: TieredRole): AssignmentRow => ({
    kind: "role",
    id: role.id,
    name: role.name,
    color: roleColorOrNull(role.color),
    held: held.has(role.id),
    disabledReason: roleReason(role, inputs),
  });

  const sections: AssignmentSection[] = [];
  const tierIds = new Set(inputs.tiers.map((tier) => tier.id));
  for (const tier of [...inputs.tiers].sort(
    (a, b) => a.position - b.position,
  )) {
    const rows = assignable
      .filter((role) => role.tier_id === tier.id)
      .sort(byOrder)
      .map(roleRow);
    if (rows.length > 0)
      sections.push({ key: tier.id, title: tier.name, rows });
  }
  const outside = assignable
    .filter((role) => role.tier_id === null || !tierIds.has(role.tier_id))
    .sort(byOrder)
    .map(roleRow);
  if (outside.length > 0) {
    sections.push({
      key: "outside",
      title: inputs.outsideTitle ?? "Other roles",
      rows: outside,
    });
  }

  const groupRows = inputs.groups
    .filter((group) => group.kind === "manual" && matches(group.name))
    .map<AssignmentRow>((group) => ({
      kind: "group",
      id: group.id,
      name: group.name,
      color: roleColorOrNull(group.color),
      held: group.member_ids.includes(inputs.userId),
      disabledReason: inputs.canManageGroups ? null : ASSIGN_CAPTIONS.noGroups,
    }));
  if (groupRows.length > 0) {
    sections.push({ key: "groups", title: "Groups", rows: groupRows });
  }
  return sections;
}

/** A chip on the profile: a role or group the member has. */
export type AssignmentChip = {
  kind: "role" | "group";
  id: string;
  name: string;
  color: string | null;
  /**
   * Whether the viewer can take it away from the chip itself: a role they
   * may give, or one of the chapter's own groups they may change. A pledge
   * class's or class year's group never can.
   */
  removable: boolean;
};

/**
 * The member's groups as chips, the chapter's own first, then the ones that
 * follow their pledge class and graduation year.
 */
export function memberGroupChips(
  groups: readonly ChapterGroup[],
  userId: string,
  canManageGroups: boolean,
): AssignmentChip[] {
  const theirs = groups.filter((group) => group.member_ids.includes(userId));
  const manual = theirs.filter((group) => group.kind === "manual");
  const automatic = theirs.filter((group) => group.kind !== "manual");
  return [...manual, ...automatic].map((group) => ({
    kind: "group",
    id: group.id,
    name: group.name,
    color: roleColorOrNull(group.color),
    removable: canManageGroups && group.kind === "manual",
  }));
}

/**
 * The member's roles as chips in rank order (tier position, then the role's
 * own order), the Everyone role left out.
 */
export function memberRoleChips(inputs: {
  roles: readonly TieredRole[];
  tiers: readonly TierRow[];
  heldRoleIds: readonly string[];
  reach: Reach;
  canManageRoles: boolean;
}): AssignmentChip[] {
  const held = new Set(inputs.heldRoleIds);
  return sortRolesByRank(
    inputs.roles.filter((role) => held.has(role.id) && !isEveryoneRole(role)),
    tierPositionsOf(inputs.tiers),
  ).map((role) => ({
    kind: "role",
    id: role.id,
    name: role.name,
    color: roleColorOrNull(role.color),
    removable:
      inputs.canManageRoles &&
      inputs.reach.known &&
      !isWildcardRole(role) &&
      reachesRole(inputs.reach, role, inputs.tiers),
  }));
}
