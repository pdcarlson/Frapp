/**
 * `spec/behavior/events.md` § `required_role_ids` wire semantics: `null` and
 * `[]` are both "untargeted" (visible/counted for everyone). The single
 * predicate every role-targeting check goes through, so a future change to
 * the matching rule (e.g. also honouring `custom_role_ids`) can't be applied
 * to one call site and missed on another.
 */
export function hasRequiredRole(
  requiredRoleIds: string[] | null | undefined,
  memberRoleIds: readonly string[],
): boolean {
  if (!requiredRoleIds || requiredRoleIds.length === 0) return true;
  return requiredRoleIds.some((roleId) => memberRoleIds.includes(roleId));
}
