import { SystemPermissions } from '../../domain/constants/permissions';
import type { CustomFieldVisibility } from '../../domain/entities/chapter-custom-field.entity';

/**
 * Resolve which custom-field visibility tiers a viewer may see on a target
 * member, given the viewer's effective permission set and whether the viewer is
 * the target. Enforced server-side per spec/behavior/members.md → Custom Fields.
 *
 * Tier rules (spec/behavior/rbac.md → Custom-field visibility tiers):
 *   - `chapter`   → any viewer who can see the directory (always included; the
 *                   caller has already passed the `members:view` guard).
 *   - `self`      → only when the viewer is the member themselves (owner). NOT
 *                   president-overridden: private fields stay private.
 *   - `exec`      → viewers with member/role management authority
 *                   (`roles:manage` or `members:remove`) or the wildcard.
 *   - `president` → only the wildcard `*` holder.
 *
 * `sensitive` fields follow the same gate: a field outside the allowed set is
 * never selected, so its value never enters the response.
 */
export function allowedVisibilities(
  effectivePermissions: readonly string[],
  isSelf: boolean,
): Set<CustomFieldVisibility> {
  const perms = new Set(effectivePermissions);
  const isPresident = perms.has(SystemPermissions.WILDCARD);
  const isExec =
    isPresident ||
    perms.has(SystemPermissions.ROLES_MANAGE) ||
    perms.has(SystemPermissions.MEMBERS_REMOVE);

  const allowed = new Set<CustomFieldVisibility>(['chapter']);
  if (isSelf) allowed.add('self');
  if (isExec) allowed.add('exec');
  if (isPresident) allowed.add('president');
  return allowed;
}
