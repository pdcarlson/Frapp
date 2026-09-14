export type RoleOption = { id: string; name: string };

/**
 * Normalize a loosely-typed roles payload (from `useRoles()` / `GET /v1/roles`)
 * into `{ id, name }[]`, dropping any entry without a string `id` and `name`.
 * Shared by the events, settings and members surfaces so the duck-typing lives
 * in one place.
 *
 * `members-directory.tsx` deliberately does not use this: it needs a fourth
 * field (`isPresident`, derived from the wildcard permission) to keep the
 * President role out of the bulk-assign dropdown, so it is a different
 * function over the same payload rather than a copy of this one.
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
