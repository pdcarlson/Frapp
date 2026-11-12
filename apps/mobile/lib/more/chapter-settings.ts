import { can, canAny } from "@repo/validation";

/**
 * Who sees Chapter settings on the phone, and which of its groups (#4074).
 *
 * Web's nav row opens for anyone with a page there (`hasSettingsDestination`
 * in `apps/web/components/settings/settings-access.ts`). The phone carries
 * two of those pages, so its row opens for the same people only where it has
 * something to show them: a treasurer who holds just `billing:view` reaches
 * Plan and billing on web, and would find nothing here.
 *
 * - `chapter`: the accent, chat background and study zones, behind
 *   `chapter-config:view`, as the Settings group they moved from was.
 * - `roles`: web's Roles tab gate, `chapter-config:view` or `roles:manage`.
 *
 * `usePermissionList()` is `[]` while loading, so every answer here is false
 * until the role is read: the row fails closed.
 */
export function chapterSettingsAccess(permissions: readonly string[]) {
  const chapter = can("chapter-config:view", permissions);
  const roles = canAny(["chapter-config:view", "roles:manage"], permissions);
  return { chapter, roles, any: chapter || roles };
}
