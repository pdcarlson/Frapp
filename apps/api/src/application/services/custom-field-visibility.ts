import { SystemPermissions } from '../../domain/constants/permissions';
import type { CustomFieldVisibility } from '../../domain/entities/chapter-custom-field.entity';

/**
 * Resolve which custom-field visibility tiers a viewer may see on a target
 * member, given the viewer's effective permission set and whether the viewer is
 * the target. Enforced server-side per spec/behavior/members.md → Custom Fields.
 *
 * Tier rules (spec/behavior/rbac.md → Custom-field visibility tiers):
 *   - `chapter`   → any viewer who can see the directory (`members:view`), plus
 *                   exec/president who are strictly more privileged and so also
 *                   see the less-restricted chapter tier. Gated explicitly here
 *                   as defense-in-depth: a caller with none of these can never
 *                   receive chapter-tier fields.
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

  const allowed = new Set<CustomFieldVisibility>();
  // `chapter` = directory viewers (`members:view`). Exec/president are strictly
  // more privileged (they see exec/president-tier fields), so they also get the
  // less-restricted chapter tier — and their effective set may be just `['*']`
  // or an exec permission without the literal `members:view` token, so gate on
  // `isExec` (which includes the wildcard) as well. A viewer with none of these
  // can never receive chapter-tier fields (defense-in-depth).
  if (isExec || perms.has(SystemPermissions.MEMBERS_VIEW)) {
    allowed.add('chapter');
  }
  if (isSelf) allowed.add('self');
  if (isExec) allowed.add('exec');
  if (isPresident) allowed.add('president');
  return allowed;
}
