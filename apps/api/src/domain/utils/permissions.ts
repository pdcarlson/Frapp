import { WILDCARD } from '../constants/permissions';

/**
 * Flatten live-role permissions and custom-role capabilities into one
 * effective permission set (bridge model, spec/behavior/rbac.md).
 *
 * This is the single definition of the flatten policy: the union of all
 * live-role `permissions` plus all custom-role `capabilities`, except that
 * the wildcard is only honored from live roles — a custom role carrying `*`
 * (pre-validation data) must never mint a second President. Both
 * `PermissionsGuard` and `RbacService` call this so route enforcement can
 * never drift from what `/users/me/permissions` reports.
 */
export function flattenPermissionSets(
  rolePermissionLists: readonly (readonly string[] | null | undefined)[],
  customRoleCapabilityLists: readonly (readonly string[] | null | undefined)[],
): Set<string> {
  const set = new Set<string>();
  for (const permissions of rolePermissionLists) {
    for (const permission of permissions ?? []) set.add(permission);
  }
  for (const capabilities of customRoleCapabilityLists) {
    for (const capability of capabilities ?? []) {
      if (capability !== WILDCARD) set.add(capability);
    }
  }
  return set;
}
