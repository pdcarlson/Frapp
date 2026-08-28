export type RoleOption = { id: string; name: string };

/**
 * Normalize a loosely-typed roles payload (from `useRoles()` / `GET /v1/roles`)
 * into `{ id, name }[]`, dropping any entry without a string `id` and `name`.
 * Shared by the events editor/detail surfaces so the duck-typing lives in one
 * place. (The members surfaces still inline their own copy — see FRA follow-up.)
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
