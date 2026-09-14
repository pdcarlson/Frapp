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
