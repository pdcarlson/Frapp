import {
  BASE_ROLE_SYSTEM_KEYS,
  compareRolesByRank,
  isBaseRole,
  isEveryoneRole,
  roleColorOrNull,
  tierPositionsOf,
} from "@repo/validation";
import { matchesWordStarts, normalizeWords } from "./fuzzy-match";
import type { ChapterGroup } from "./use-groups";
import {
  assignsRole,
  assignsToMember,
  isWildcardRole,
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
 * chapter's own groups. A pledge class's, class year's or major's group follows the
 * member's own details and is never offered. A group a channel's access list
 * names also needs `channels:manage`; the client can't see which lists name
 * which groups, so that refusal comes back from the API.
 */

/** Why a role row is shown but can't be ticked. */
export const ASSIGN_CAPTIONS = {
  presidency: "Changes with Transfer presidency",
  checking: "Checking what your role can give",
  ranksAbove: "Ranks at or above yours",
  memberAbove: "They rank at or above you",
  noRoles: "Your role can't give roles",
  noGroups: "Your role can't change groups",
} as const;

/**
 * The words both apps use when a role or group change from a member goes
 * wrong, so the web card and the phone sheet say the same.
 */
export const ASSIGN_COPY = {
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
  if (group.kind === "major") return "Follows major";
  return null;
}

export type AssignmentRow = {
  kind: "role" | "group";
  id: string;
  name: string;
  /** A paintable color (`roleColorOrNull`), or `null` for none. */
  color: string | null;
  /** Whether the member has it now. */
  held: boolean;
  /**
   * A base role (New Member, Actives, Alumni): one of a set the member holds
   * at most one of, so it is drawn as a radio, and picking it takes the
   * others away (`rolesAfterSave`).
   */
  exclusive?: boolean;
  /** Why it can't be ticked, or `null` when it can. */
  disabledReason: string | null;
};

export type AssignmentSection = {
  /** Stable key: `base`, a tier id, `outside`, or `groups`. */
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
  if (!memberReachable(inputs)) return ASSIGN_CAPTIONS.memberAbove;
  if (!assignsRole(inputs.reach, role, inputs.tiers)) {
    return ASSIGN_CAPTIONS.ranksAbove;
  }
  return null;
}

/** Whether the rank rules let the viewer change this member's roles. */
function memberReachable(inputs: {
  reach: Reach;
  roles: readonly TieredRole[];
  tiers: readonly TierRow[];
  heldRoleIds: readonly string[];
  userId?: string;
}): boolean {
  // Without the member's id the API decides, as before.
  if (inputs.userId === undefined) return true;
  return assignsToMember(
    inputs.reach,
    { userId: inputs.userId, roleIds: inputs.heldRoleIds },
    inputs.roles,
    inputs.tiers,
  );
}

/**
 * The "+ Add" list for one member: their base role first (New Member,
 * Actives, Alumni, one of which an officer gives each member; Paul,
 * 2026-11-21), then a section per tier (highest first) with its other roles,
 * then roles outside the tiers, then the chapter's own groups. The Everyone
 * role, which every member holds, is never a row. Sections a search empties
 * are left out.
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
    (role) => !isEveryoneRole(role) && !isBaseRole(role) && matches(role.name),
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
  const baseRows = baseRolesInOrder(inputs.roles)
    .filter((role) => matches(role.name))
    .map((role) => ({ ...roleRow(role), exclusive: true }));
  if (baseRows.length > 0) {
    sections.push({ key: "base", title: BASE_ROLE_HEADING, rows: baseRows });
  }
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

/** The heading of the base role section, the same on both apps. */
export const BASE_ROLE_HEADING = "Base role";

/** What a member with no base role shows where it would be. */
export const NO_BASE_ROLE_LABEL = "No base role";

/** The chapter's base roles in their one order: New Member, Actives, Alumni. */
export function baseRolesInOrder<R extends { system_key?: string | null }>(
  roles: readonly R[],
): R[] {
  const order = (role: R) =>
    (BASE_ROLE_SYSTEM_KEYS as readonly unknown[]).indexOf(role.system_key);
  return roles.filter(isBaseRole).sort((a, b) => order(a) - order(b));
}

/**
 * Whether a member holds none of the chapter's base roles, so they see only
 * what the whole chapter may. False for a chapter with no base roles at all.
 */
export function needsBaseRole(
  roles: readonly { id: string; system_key?: string | null }[],
  heldRoleIds: readonly string[],
): boolean {
  const base = roles.filter(isBaseRole);
  if (base.length === 0) return false;
  const held = new Set(heldRoleIds);
  return !base.some((role) => held.has(role.id));
}

/**
 * The Members Role filter's pick for members holding no base role (#5802):
 * they joined with Everyone alone and see only what the whole chapter may
 * until an officer gives them New Member, Actives or Alumni. Offered on web
 * and the phone, beside "Any role", to whoever can give roles.
 */
export const NO_BASE_ROLE_FILTER = "no-base-role" as const;

/**
 * Whether a member passes the Role filter: any role (`null`), a role they
 * hold, or {@link NO_BASE_ROLE_FILTER} when they hold no base role.
 */
export function matchesRoleFilter(
  roles: readonly { id: string; system_key?: string | null }[],
  heldRoleIds: readonly string[],
  roleFilter: string | null,
): boolean {
  if (roleFilter === null) return true;
  if (roleFilter === NO_BASE_ROLE_FILTER) {
    return needsBaseRole(roles, heldRoleIds);
  }
  return heldRoleIds.includes(roleFilter);
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
   * class's, class year's or major's group never can.
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
 * The member's roles as chips, highest-ranked first, by the same rank every
 * other surface uses (`compareRolesByRank`, `spec/behavior/rbac.md` § Rank),
 * the Everyone role left out.
 */
export function memberRoleChips(inputs: {
  roles: readonly TieredRole[];
  tiers: readonly TierRow[];
  heldRoleIds: readonly string[];
  reach: Reach;
  canManageRoles: boolean;
  /** The member's `users.id`, so the rank rules can place them. */
  userId?: string;
}): AssignmentChip[] {
  const positions = tierPositionsOf(inputs.tiers);
  const held = new Set(inputs.heldRoleIds);
  return inputs.roles
    .filter((role) => held.has(role.id) && !isEveryoneRole(role))
    .sort((a, b) => compareRolesByRank(a, b, positions))
    .map((role) => ({
      kind: "role",
      id: role.id,
      name: role.name,
      color: roleColorOrNull(role.color),
      removable:
        inputs.canManageRoles &&
        inputs.reach.known &&
        !isWildcardRole(role) &&
        memberReachable(inputs) &&
        assignsRole(inputs.reach, role, inputs.tiers),
    }));
}

/**
 * How many chips a profile's roles or groups row shows before it folds the
 * rest behind "+N more" (Shawn, 2026-11-20, #5783: a member holding a
 * position, a floor, a tree and majors had a wall of chips). Discord's
 * profile lists every role; this keeps the top three, in rank order, and
 * opens the rest in place.
 */
export const CHIP_PREVIEW_COUNT = 3;

export type ChipCut<T> = {
  /** The chips to draw now. */
  shown: T[];
  /** How many the row folds away, 0 when it shows them all. */
  hidden: number;
  /**
   * The toggle after the chips: "+N more" while folded, "Show less" once
   * opened, or `null` when the row is short enough to need neither.
   */
  toggle: { label: string; expands: boolean } | null;
};

/**
 * The cut one roles or groups row makes, the same on web and phone. Chips
 * arrive in their order (`memberRoleChips` ranks them), so the first three
 * are the member's highest. A row that would fold away only one chip shows
 * it instead: "+1 more" takes about the room of the chip it hides.
 */
export function cutChips<T>(
  chips: readonly T[],
  expanded: boolean,
): ChipCut<T> {
  if (chips.length <= CHIP_PREVIEW_COUNT + 1) {
    return { shown: [...chips], hidden: 0, toggle: null };
  }
  if (expanded) {
    return {
      shown: [...chips],
      hidden: 0,
      toggle: { label: "Show less", expands: false },
    };
  }
  const hidden = chips.length - CHIP_PREVIEW_COUNT;
  return {
    shown: chips.slice(0, CHIP_PREVIEW_COUNT),
    hidden,
    toggle: { label: `+${hidden} more`, expands: true },
  };
}

/**
 * The toggle's accessible name on both apps: its visible words first, so a
 * voice-control "Tap Show less" still finds it, then which row it opens,
 * since the Roles and Groups rows can each show one ("+5 more roles").
 */
export function chipToggleName(
  toggle: { label: string },
  noun: "roles" | "groups",
): string {
  return `${toggle.label} ${noun}`;
}
