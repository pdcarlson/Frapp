import type {
  EventAttendanceDraft,
  EventAttendanceStatus,
} from "@repo/validation";

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

/** Roles to offer for adding: not already set, matching every typed word. */
export function rolesToAdd(
  options: readonly RoleOption[],
  draft: EventAttendanceDraft,
  query: string,
): RoleOption[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return options.filter(
    (role) =>
      !(role.id in draft.roles) &&
      words.every((word) => role.name.toLowerCase().includes(word)),
  );
}

/**
 * What a role is set to when it is added: the first answer that differs from
 * the default, in the order an officer most often wants it. Optional for
 * everyone, so a role added is usually the one that must come; required for
 * everyone, so a role added is usually the one excused (alumni, new members);
 * nobody else invited, so a role added is one that must come.
 */
export function statusForAddedRole(
  everyone: EventAttendanceStatus,
): EventAttendanceStatus {
  return everyone === "required" ? "optional" : "required";
}

/** The two answers a role row offers: every status except the default. */
export function roleChoicesFor(
  everyone: EventAttendanceStatus,
): EventAttendanceStatus[] {
  return (["required", "optional", "not_invited"] as const).filter(
    (status) => status !== everyone,
  );
}

/**
 * The draft after the default changes. A role whose status now equals the
 * default no longer differs, so it leaves the list.
 */
export function withEveryone(
  draft: EventAttendanceDraft,
  everyone: EventAttendanceStatus,
): EventAttendanceDraft {
  const roles: Record<string, EventAttendanceStatus> = {};
  for (const [id, status] of Object.entries(draft.roles)) {
    if (status !== everyone) roles[id] = status;
  }
  return { everyone, roles };
}

export function withRole(
  draft: EventAttendanceDraft,
  roleId: string,
  status: EventAttendanceStatus | null,
): EventAttendanceDraft {
  const roles = { ...draft.roles };
  if (status === null || status === draft.everyone) delete roles[roleId];
  else roles[roleId] = status;
  return { ...draft, roles };
}
