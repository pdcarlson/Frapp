export type RoleOption = { id: string; name: string };

/**
 * Normalize a loosely-typed roles payload (from `useRoles()` / `GET /v1/roles`)
 * into `{ id, name }[]`, dropping any entry without a string `id` and `name`.
 * Shared by the events, settings and members surfaces so the duck-typing lives
 * in one place.
 *
 * `members-directory.tsx` deliberately does not use this: it carries a third
 * field, `isPresident`, which it derives from two payload keys this function
 * drops — `is_system === true` AND `permissions` containing the wildcard `*`.
 * Both halves are load-bearing: a legacy non-system role may carry a
 * pre-validation `*` (the **Wildcard exclusion** rule in
 * `spec/behavior/rbac.md`), so keying
 * on the wildcard alone would hide a role that is genuinely assignable. It is
 * a different function over the same payload, not a copy of this one.
 */
export function normalizeRoleOptions(data: unknown): RoleOption[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((role: unknown) => {
    if (!role || typeof role !== "object") return [];
    const candidate = role as Record<string, unknown>;
    if (typeof candidate.id !== "string" || typeof candidate.name !== "string") {
      return [];
    }
    return [{ id: candidate.id, name: candidate.name }];
  });
}

/**
 * The ids, live and custom, whose holder can open chat, the roster and events:
 * a live role carrying `members:view` (or `*`), or a custom role whose
 * capabilities carry `members:view`. That is how `PermissionsGuard` reads it,
 * including dropping `*` from custom roles. The seeded flag doesn't count on
 * its own, because a seeded role's permissions are editable. Live and custom
 * ids are both uuids, so one set holds them without collisions.
 */
export function memberAccessRoleIds(
  rolesData: unknown,
  customRoles?: readonly {
    id: string;
    capabilities?: readonly string[] | null;
  }[],
): Set<string> {
  const ids = new Set<string>();
  if (Array.isArray(rolesData)) {
    for (const role of rolesData as unknown[]) {
      if (!role || typeof role !== "object") continue;
      const candidate = role as Record<string, unknown>;
      if (typeof candidate.id !== "string") continue;
      const permissions = Array.isArray(candidate.permissions)
        ? candidate.permissions
        : [];
      if (permissions.includes("members:view") || permissions.includes("*")) {
        ids.add(candidate.id);
      }
    }
  }
  for (const role of customRoles ?? []) {
    if (role.capabilities?.includes("members:view")) ids.add(role.id);
  }
  return ids;
}

/**
 * True when a role save is the one that takes away member access (#3670).
 * A member who already lacked it is not warned again on every save.
 */
export function removesMemberAccess(
  before: readonly string[],
  after: readonly string[],
  accessIds: ReadonlySet<string>,
): boolean {
  const grants = (ids: readonly string[]) => ids.some((id) => accessIds.has(id));
  return grants(before) && !grants(after);
}
