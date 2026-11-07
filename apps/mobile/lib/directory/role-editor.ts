/**
 * The logic behind editing a member's roles from their profile (Directory, tap
 * a member, Roles). It is the one place on mobile where an officer changes
 * someone's roles; there is no press-and-hold or second entry point (Paul,
 * 2026-11-07).
 *
 * The editor works on `role_ids` only. `custom_role_ids` is left out of every
 * save, which the API reads as "leave unchanged", so a custom role the officer
 * cannot see here is never stripped.
 *
 * Sized for a real chapter, not a seed: Paul's has 113 roles after its Discord
 * import, so the list is searched, and its order is fixed when the editor
 * opens (held roles first) so a row never jumps out from under a finger.
 */
import { can, WILDCARD_PERMISSION } from "@repo/validation";
import { records, str } from "../more/narrow";

export interface RoleOption {
  id: string;
  name: string;
  color: string | null;
  /**
   * Carries `*` (President). The API refuses to move such a role here; it
   * changes hands only through Transfer presidency.
   */
  locked: boolean;
  /**
   * Holding it is enough to open chat, the roster and events: a seeded system
   * role, or any role carrying `members:view`. A Discord-imported role carries
   * only its channel reads, so on its own it locks a member out (2026-11-07).
   */
  grantsBase: boolean;
}

/** `GET /v1/roles` declares no response schema, so it is read defensively. */
export function parseRoleOptions(rolesData: unknown): RoleOption[] {
  const options: RoleOption[] = [];
  for (const row of records(rolesData)) {
    const id = str(row, "id");
    const name = str(row, "name");
    if (!id || !name) continue;
    const permissions = Array.isArray(row.permissions)
      ? row.permissions.filter((p): p is string => typeof p === "string")
      : [];
    options.push({
      id,
      name,
      color: str(row, "color"),
      locked: permissions.includes(WILDCARD_PERMISSION),
      grantsBase: row.is_system === true || can("members:view", permissions),
    });
  }
  return options;
}

/**
 * The editor's row order, taken once when it opens: the roles the member holds,
 * then the rest, each by name. Toggling never re-sorts, so the row under a
 * finger stays put.
 */
export function orderRoleOptions(
  options: readonly RoleOption[],
  heldIds: readonly string[],
): RoleOption[] {
  const held = new Set(heldIds);
  const byName = (a: RoleOption, b: RoleOption) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  return [
    ...options.filter((o) => held.has(o.id)).sort(byName),
    ...options.filter((o) => !held.has(o.id)).sort(byName),
  ];
}

export function filterRoleOptions(
  options: readonly RoleOption[],
  search: string,
): readonly RoleOption[] {
  const needle = search.trim().toLowerCase();
  if (needle.length === 0) return options;
  return options.filter((o) => o.name.toLowerCase().includes(needle));
}

/**
 * The member's role ids with `roleId` turned on or off. Ids the list doesn't
 * know (a deleted role) are kept: the API exempts ids a member already holds,
 * and dropping them here would be a change the officer never made.
 */
export function toggleRole(
  heldIds: readonly string[],
  roleId: string,
): string[] {
  const unique = [...new Set(heldIds)];
  return unique.includes(roleId)
    ? unique.filter((id) => id !== roleId)
    : [...unique, roleId];
}

export function hasBaseAccess(
  heldIds: readonly string[],
  options: readonly RoleOption[],
): boolean {
  const held = new Set(heldIds);
  return options.some((o) => o.grantsBase && held.has(o.id));
}

/**
 * True when this change is the one that takes away chat, the roster and
 * events. A member who already lacked base access is not warned again on
 * every tap.
 */
export function removesBaseAccess(
  before: readonly string[],
  after: readonly string[],
  options: readonly RoleOption[],
): boolean {
  return hasBaseAccess(before, options) && !hasBaseAccess(after, options);
}

export const ROLES_LOCKED_CAPTION = "Changes with Transfer presidency";

export function removeBaseAccessTitle(name: string): string {
  return `Take away ${name}'s access?`;
}

export function removeBaseAccessBody(name: string): string {
  return `Without a role like Member, ${name} can't open chat, the member list or events.`;
}

export const ROLES_SAVE_FAILED_TITLE = "Couldn't save roles";

/**
 * Why a save failed, by the API's answer: a 400 is a role deleted since the
 * list loaded, a 403 a viewer who can no longer edit roles (for one, an
 * officer who just took away their own). Neither is fixed by trying again.
 */
export function rolesSaveFailedBody(status: number | undefined): string {
  if (status === 400) {
    return "One of those roles was just deleted. The list has been refreshed and the change put back.";
  }
  if (status === 403) {
    return "You can no longer change roles, so the change was put back.";
  }
  return "That change didn't reach the server, so it was put back. Try again.";
}

/** Custom roles keep their own editor on the web; this one changes `role_ids`. */
export function customRolesCaption(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  return `${names.join(", ")} ${names.length === 1 ? "is a custom role" : "are custom roles"}, changed on the web.`;
}
