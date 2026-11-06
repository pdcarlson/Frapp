/**
 * Who an event is for, per role: `spec/behavior/events.md` § Attendance by role.
 *
 * An event sets one default for the whole chapter ("everyone else") and may
 * name roles that differ from it. Each role is Required, Optional or Not
 * invited; so is the default. The columns that carry it:
 *
 * - `required_role_ids`: roles that must attend.
 * - `optional_role_ids`: roles invited, not required.
 * - `excluded_role_ids`: roles not invited.
 * - `others_invited` + `is_mandatory`: the default for a member who holds none
 *   of those roles. Not invited when `others_invited` is false; otherwise
 *   Required when `is_mandatory`, else Optional.
 *
 * A member who holds several listed roles gets the strongest of them
 * (Required, then Optional, then Not invited), so an officer who is also a new
 * member is still required at an officers-only meeting. A listed role always
 * beats the default.
 *
 * Every check (who sees the event, who may check in, who the auto-absent sweep
 * marks, who is notified) reads through {@link eventAttendanceFor}, in the API
 * and in the apps, so one rule decides them all.
 */

export const EVENT_ATTENDANCE_STATUSES = [
  "required",
  "optional",
  "not_invited",
] as const;

export type EventAttendanceStatus = (typeof EVENT_ATTENDANCE_STATUSES)[number];

/** The words a picker shows for each status. */
export const EVENT_ATTENDANCE_LABELS: Record<EventAttendanceStatus, string> = {
  required: "Required",
  optional: "Optional",
  not_invited: "Not invited",
};

/** The event fields the rule reads. Older rows may lack the new columns. */
export interface EventAttendanceFields {
  is_mandatory?: boolean | null;
  required_role_ids?: readonly string[] | null;
  optional_role_ids?: readonly string[] | null;
  excluded_role_ids?: readonly string[] | null;
  /** Absent on a row written before the column: read as `true`. */
  others_invited?: boolean | null;
}

export interface EventAttendance {
  status: EventAttendanceStatus;
  /**
   * True when a listed role decided the status, false when the default did.
   * The alumni rule hangs on this: an alumnus is held to a non-targeted event
   * only when a role names them (`spec/behavior/alumni.md`).
   */
  byRole: boolean;
}

function holdsAny(
  listed: readonly string[] | null | undefined,
  memberRoleIds: readonly string[],
): boolean {
  if (!listed || listed.length === 0) return false;
  return listed.some((roleId) => memberRoleIds.includes(roleId));
}

/** The default status for a member who holds none of the listed roles. */
export function eventDefaultAttendance(
  event: EventAttendanceFields,
): EventAttendanceStatus {
  if (event.others_invited === false) return "not_invited";
  return event.is_mandatory ? "required" : "optional";
}

/** What `event` asks of a member holding `memberRoleIds`. */
export function eventAttendanceFor(
  event: EventAttendanceFields,
  memberRoleIds: readonly string[],
): EventAttendance {
  if (holdsAny(event.required_role_ids, memberRoleIds)) {
    return { status: "required", byRole: true };
  }
  if (holdsAny(event.optional_role_ids, memberRoleIds)) {
    return { status: "optional", byRole: true };
  }
  if (holdsAny(event.excluded_role_ids, memberRoleIds)) {
    return { status: "not_invited", byRole: true };
  }
  return { status: eventDefaultAttendance(event), byRole: false };
}

/**
 * Whether anyone is kept out: the event's read gate (list, detail, search,
 * feed, `.ics`, pushes) only has work to do when this is true.
 */
export function eventLimitsAudience(event: EventAttendanceFields): boolean {
  return (
    event.others_invited === false || (event.excluded_role_ids?.length ?? 0) > 0
  );
}

/** Whether anyone at all is required: the auto-absent sweep's filter. */
export function eventRequiresAnyone(event: EventAttendanceFields): boolean {
  return (
    (event.required_role_ids?.length ?? 0) > 0 ||
    (event.others_invited !== false && Boolean(event.is_mandatory))
  );
}

/**
 * An editor's draft of the rule: the default and the roles that differ from
 * it. The apps build it, {@link attendanceToWire} turns it into the columns.
 */
export interface EventAttendanceDraft {
  everyone: EventAttendanceStatus;
  /** Role id to its status. A role whose status equals `everyone` is dropped. */
  roles: Record<string, EventAttendanceStatus>;
}

export interface EventAttendanceWire {
  is_mandatory: boolean;
  others_invited: boolean;
  required_role_ids: string[];
  optional_role_ids: string[];
  excluded_role_ids: string[];
}

/** The draft as request fields. Every field is sent, so an edit can clear. */
export function attendanceToWire(
  draft: EventAttendanceDraft,
): EventAttendanceWire {
  const byStatus: Record<EventAttendanceStatus, string[]> = {
    required: [],
    optional: [],
    not_invited: [],
  };
  for (const [roleId, status] of Object.entries(draft.roles)) {
    if (status === draft.everyone) continue;
    byStatus[status].push(roleId);
  }
  return {
    is_mandatory: draft.everyone === "required",
    others_invited: draft.everyone !== "not_invited",
    required_role_ids: byStatus.required,
    optional_role_ids: byStatus.optional,
    excluded_role_ids: byStatus.not_invited,
  };
}

/** A stored event back into an editor's draft. */
export function attendanceFromEvent(
  event: EventAttendanceFields,
): EventAttendanceDraft {
  const everyone = eventDefaultAttendance(event);
  const roles: Record<string, EventAttendanceStatus> = {};
  // Lowest precedence first, so a role listed twice keeps the stronger status.
  for (const id of event.excluded_role_ids ?? []) roles[id] = "not_invited";
  for (const id of event.optional_role_ids ?? []) roles[id] = "optional";
  for (const id of event.required_role_ids ?? []) roles[id] = "required";
  for (const [id, status] of Object.entries(roles)) {
    if (status === everyone) delete roles[id];
  }
  return { everyone, roles };
}

/** A fresh event's rule: everyone invited, nobody required. */
export function emptyAttendanceDraft(): EventAttendanceDraft {
  return { everyone: "optional", roles: {} };
}

/**
 * One line for a collapsed editor row or an event's detail: "Optional for
 * everyone", "Required for everyone, 2 roles differ", "Officers only".
 * `roleName` resolves an id; an unknown id reads as "a role".
 */
export function describeAttendance(
  draft: EventAttendanceDraft,
  roleName: (roleId: string) => string | undefined,
): string {
  const entries = Object.entries(draft.roles).filter(
    ([, status]) => status !== draft.everyone,
  );
  if (entries.length === 0) {
    if (draft.everyone === "not_invited") return "Nobody invited yet";
    return `${EVENT_ATTENDANCE_LABELS[draft.everyone]} for everyone`;
  }
  const names = (status: EventAttendanceStatus) =>
    entries
      .filter(([, s]) => s === status)
      .map(([id]) => roleName(id) ?? "a role");
  const list = (items: string[]) =>
    items.length <= 2
      ? items.join(" and ")
      : `${items.slice(0, 2).join(", ")} +${items.length - 2}`;

  if (draft.everyone === "not_invited") {
    const required = names("required");
    const optional = names("optional");
    if (optional.length === 0) return `${list(required)} only, required`;
    if (required.length === 0) return `${list(optional)} only, optional`;
    return `Required for ${list(required)}, optional for ${list(optional)}`;
  }
  const differ =
    entries.length === 1 ? "1 role differs" : `${entries.length} roles differ`;
  if (entries.length <= 2) {
    const parts = entries.map(
      ([id, status]) =>
        `${EVENT_ATTENDANCE_LABELS[status].toLowerCase()} for ${roleName(id) ?? "a role"}`,
    );
    return `${EVENT_ATTENDANCE_LABELS[draft.everyone]} for everyone, ${parts.join(", ")}`;
  }
  return `${EVENT_ATTENDANCE_LABELS[draft.everyone]} for everyone, ${differ}`;
}
