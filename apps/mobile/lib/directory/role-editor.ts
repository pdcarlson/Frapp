/**
 * The logic behind editing a member's roles from their profile (Directory, tap
 * a member, Roles). It is the one place on mobile where an officer changes
 * someone's roles; there is no press-and-hold or second entry point (Paul,
 * 2026-11-07).
 *
 * Sized for a real chapter, not a seed: Paul's has 113 roles after its Discord
 * import, so the list is searched. Its rows and their order come from
 * `memberAssignmentSections` (`@repo/hooks`), shared with web.
 */
import type { ChapterRole } from "@repo/hooks/chapter-roles";
import {
  memberAccessRoleIds,
  removesMemberAccess,
  rolesAfterSave,
} from "@repo/validation";

/**
 * A role as the editor lists it: `GET /v1/roles` read once, by
 * `parseChapterRoles` (`@repo/hooks/chapter-roles`), which web reads too. A
 * `locked` role carries `*` (President); the API refuses to move it here, so it
 * changes hands only through Transfer presidency.
 */
export type RoleOption = ChapterRole;

/**
 * The member's role ids with `roleId` turned on or off. Ids the list doesn't
 * know are kept: the API exempts ids a member already holds, and dropping
 * them here would be a change the officer never made. A role delete takes its
 * id off its holders (#4547), so one only lingers here from a stale read.
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

/**
 * True when this change is the one that takes away chat, the roster and
 * events. A member who already lacked base access is not warned again on
 * every tap. The rule is web's too (`removesMemberAccess` in
 * `@repo/validation`), asked of the roles the save ends with once the API
 * settles the Everyone role (`rolesAfterSave`, #4191): a member left with no
 * other role giving access keeps or gets Everyone.
 */
export function removesBaseAccess(
  before: readonly string[],
  after: readonly string[],
  options: readonly RoleOption[],
): boolean {
  const settled = rolesAfterSave(after, before, options);
  return removesMemberAccess(before, settled, memberAccessRoleIds(options));
}

/**
 * Why a save failed, by the API's answer: a 400 is a role deleted since the
 * list loaded; a 403 is a change the viewer may no longer make (they lost
 * `roles:manage`, the member left the chapter, or the change touched
 * President); a 409 is a save that crossed another change to the member's
 * roles, such as a role deleted mid-save (#4830). None is fixed by trying
 * again from the same list. `name` is set when the officer
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
  if (status === 409) {
    return `Someone changed these roles at the same time. ${change} was put back and the list refreshed.`;
  }
  if (status === 403) {
    return `${change} isn't allowed any more, so it was put back.`;
  }
  return `${change} didn't reach the server, so it was put back. Try again.`;
}
