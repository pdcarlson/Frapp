import { isEveryoneRole } from "@repo/validation";

/**
 * The role list the attendance picker draws (`components/events/
 * attendance-sheet.tsx`), read off `GET /v1/roles`.
 *
 * Built for a chapter at real scale: an imported Discord server brings a
 * hundred roles or more, so the picker's list is virtualized and searchable
 * (`attendanceRows` in `@repo/validation` orders and filters it).
 */
export interface RoleOption {
  id: string;
  name: string;
  /**
   * The Everyone role (#4191): offered only when an event already sets it
   * apart, since no picker offers it otherwise. Its name still resolves.
   */
  hidden: boolean;
}

/** `GET /v1/roles` rows as `{ id, name, hidden }`, by name. Malformed rows drop. */
export function roleOptionsFrom(data: unknown): RoleOption[] {
  if (!Array.isArray(data)) return [];
  const options: RoleOption[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const { id, name } = row as { id?: unknown; name?: unknown };
    if (typeof id === "string" && typeof name === "string" && name.trim()) {
      options.push({ id, name: name.trim(), hidden: isEveryoneRole(row) });
    }
  }
  return options.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}
