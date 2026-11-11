/**
 * Flatten a member's role permission lists into one effective permission set.
 *
 * This is the single definition of the flatten policy: the union of every
 * held role's `permissions`. Both `PermissionsGuard` and `RbacService` call
 * it so route enforcement can never drift from what `/users/me/permissions`
 * reports.
 */
export function flattenPermissionSets(
  rolePermissionLists: readonly (readonly string[] | null | undefined)[],
): Set<string> {
  const set = new Set<string>();
  for (const permissions of rolePermissionLists) {
    for (const permission of permissions ?? []) set.add(permission);
  }
  return set;
}
