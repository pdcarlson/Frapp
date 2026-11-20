import { can, canAny } from "@repo/validation";

/**
 * Who sees Chapter settings on the phone, and which of its groups (#4074).
 *
 * Web's chapter menu offers it to anyone with a page there (`hasSettingsDestination`
 * in `apps/web/components/settings/settings-access.ts`). The phone carries
 * two of those pages, so its chapter menu offers it to the same people only where it has
 * something to show them: a treasurer who holds just `billing:view` reaches
 * Plan and billing on web, and would find nothing here.
 *
 * - `chapter`: the accent, chat background and study zones, behind
 *   `chapter-config:view`, as the Settings group they moved from was.
 * - `roles`: web's Roles and groups tab gate, `chapter-config:view`,
 *   `roles:manage` or `groups:manage` (one page for both since Paul's
 *   2026-11-19 call).
 *
 * `usePermissionList()` is `[]` while loading, so every answer here is false
 * until the role is read: the item fails closed.
 */
export function chapterSettingsAccess(permissions: readonly string[]) {
  const chapter = can("chapter-config:view", permissions);
  const roles = canAny(
    ["chapter-config:view", "roles:manage", "groups:manage"],
    permissions,
  );
  return { chapter, roles, any: chapter || roles };
}
