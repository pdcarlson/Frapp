import { parseChapterRoles } from "@repo/hooks/chapter-roles";

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

/**
 * `GET /v1/roles` rows (`parseChapterRoles`, shared with web) as
 * `{ id, name, hidden }`, by name.
 */
export function roleOptionsFrom(data: unknown): RoleOption[] {
  return parseChapterRoles(data)
    .map((role) => ({
      id: role.id,
      name: role.name.trim(),
      hidden: role.everyone,
    }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
}
