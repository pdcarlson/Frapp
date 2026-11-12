import { isEveryoneRole } from "@repo/validation";

export type RoleOption = {
  id: string;
  name: string;
  /**
   * Offered only where it is already set (`attendanceRows`): the Everyone
   * role, under `"hide"` below.
   */
  hidden?: boolean;
};

/**
 * What a surface does with the chapter's Everyone role (#4191), which no list
 * or picker offers: `"drop"` leaves it out (pickers, filters, the default
 * invite role), `"keep"` keeps it (a lookup from id to name), `"hide"` keeps it
 * marked `hidden` (the attendance editor, which shows it only on an event
 * already set apart for it).
 */
export type EveryoneRoleUse = "drop" | "keep" | "hide";

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
export function normalizeRoleOptions(
  data: unknown,
  everyone: EveryoneRoleUse = "drop",
): RoleOption[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((role: unknown) => {
    if (!role || typeof role !== "object") return [];
    const candidate = role as Record<string, unknown>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.name !== "string"
    ) {
      return [];
    }
    if (isEveryoneRole(candidate)) {
      if (everyone === "drop") return [];
      if (everyone === "hide") {
        return [{ id: candidate.id, name: candidate.name, hidden: true }];
      }
    }
    return [{ id: candidate.id, name: candidate.name }];
  });
}

/**
 * The roles payload as `{ id, permissions }` rows, for the shared
 * member-access rule (`memberAccessRoleIds` in `@repo/validation`).
 * `GET /v1/roles` declares no response schema, so it is read defensively,
 * like {@link normalizeRoleOptions}.
 */
export function roleAccessRows(
  data: unknown,
): { id: string; permissions: string[]; system_key: string | null }[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((role: unknown) => {
    if (!role || typeof role !== "object") return [];
    const candidate = role as Record<string, unknown>;
    // Same rows as the checklist ({@link normalizeRoleOptions} drops a role
    // without a name), so the access check never hinges on a role the
    // officer can't see or untick.
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.name !== "string"
    ) {
      return [];
    }
    const permissions = Array.isArray(candidate.permissions)
      ? candidate.permissions.filter((p): p is string => typeof p === "string")
      : [];
    const systemKey =
      typeof candidate.system_key === "string" ? candidate.system_key : null;
    return [{ id: candidate.id, permissions, system_key: systemKey }];
  });
}
