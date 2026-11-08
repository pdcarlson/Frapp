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
import {
  memberAccessRoleIds,
  removesMemberAccess,
  WILDCARD_PERMISSION,
} from "@repo/validation";
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
   * Holding it is enough to open chat, the roster and events: it carries
   * `members:view` (or `*`), the permission the API checks. The seeded flag
   * doesn't count, because a seeded role's permissions can be edited. A
   * Discord-imported role carries only its channel reads, so on its own it
   * locks a member out (2026-11-07).
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
      // The shared rule web's member sheet uses too (`@repo/validation`).
      grantsBase: memberAccessRoleIds([{ id, permissions }]).has(id),
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

/** The ids among `options` whose holder has member access. */
function baseAccessIds(options: readonly RoleOption[]): Set<string> {
  return new Set(options.filter((o) => o.grantsBase).map((o) => o.id));
}

/**
 * True when this change is the one that takes away chat, the roster and
 * events. A member who already lacked base access is not warned again on
 * every tap. The rule is web's too (`removesMemberAccess` in
 * `@repo/validation`); this editor sees live roles only, so a custom role
 * that carries `members:view` doesn't count here and the officer may be
 * asked when the member would keep access through it.
 */
export function removesBaseAccess(
  before: readonly string[],
  after: readonly string[],
  options: readonly RoleOption[],
): boolean {
  return removesMemberAccess(before, after, baseAccessIds(options));
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
 * list loaded; a 403 is a change the viewer may no longer make (they lost
 * `roles:manage`, the member left the chapter, or the change touched
 * President). Neither is fixed by trying again. `name` is set when the officer
 * has already moved on to someone else, so the alert says whose change it was.
 */
export function rolesSaveFailedBody(
  status: number | undefined,
  name: string | null = null,
): string {
  const change = name ? `Your change to ${name}'s roles` : "The change";
  if (status === 400) {
    return `One of those roles was just deleted. ${change} was put back and the list refreshed.`;
  }
  if (status === 403) {
    return `${change} isn't allowed any more, so it was put back.`;
  }
  return `${change} didn't reach the server, so it was put back. Try again.`;
}

/** Custom roles keep their own editor on the web; this one changes `role_ids`. */
export function customRolesCaption(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  return `${names.join(", ")} ${names.length === 1 ? "is a custom role" : "are custom roles"}, changed on the web.`;
}
