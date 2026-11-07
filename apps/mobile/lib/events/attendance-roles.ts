/**
 * The role list the attendance picker draws (`components/events/
 * attendance-sheet.tsx`), read off `GET /v1/roles`.
 *
 * Built for a chapter at real scale: an imported Discord server brings a
 * hundred roles or more, so the picker never lists them all as controls. It
 * shows the default, the few roles that differ from it, and a searchable list
 * to add one from.
 */
export interface RoleOption {
  id: string;
  name: string;
}

/** `GET /v1/roles` rows as `{ id, name }`, by name. Malformed rows drop. */
export function roleOptionsFrom(data: unknown): RoleOption[] {
  if (!Array.isArray(data)) return [];
  const options: RoleOption[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const { id, name } = row as { id?: unknown; name?: unknown };
    if (typeof id === "string" && typeof name === "string" && name.trim()) {
      options.push({ id, name: name.trim() });
    }
  }
  return options.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}
