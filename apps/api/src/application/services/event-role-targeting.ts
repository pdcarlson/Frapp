import {
  eventAttendanceFor,
  type EventAttendance,
  type EventAttendanceFields,
  type EventAttendanceStatus,
} from '@repo/validation';

/**
 * `spec/behavior/events.md` § Attendance by role. The API's one door to the
 * rule in `@repo/validation` (`event-attendance.ts`): who an event is for,
 * read the same way by the read gate (list, detail, search, feed),
 * check-in, the auto-absent sweep and the pushes, so a change to the rule
 * can't land at one call site and miss another.
 */
export function attendanceFor(
  event: EventAttendanceFields,
  memberRoleIds: readonly string[],
): EventAttendance {
  return eventAttendanceFor(event, memberRoleIds);
}

/** Whether a member holding `memberRoleIds` is invited to (may see) `event`. */
export function isInvited(
  event: EventAttendanceFields,
  memberRoleIds: readonly string[],
): boolean {
  return attendanceFor(event, memberRoleIds).status !== 'not_invited';
}

/**
 * What an event asks of one member, as the attendance sweep holds them to it:
 * `attendanceFor`, except that an alumnus required only by the event's default
 * (not by a role that names them) is optional, because the sweep never marks
 * them absent (`AttendanceService`, `spec/behavior/alumni.md`). The push names
 * this answer ("Required"), so it never calls an event required that the sweep
 * would not hold the member to.
 */
export function memberAttendance(
  event: EventAttendanceFields,
  memberRoleIds: readonly string[],
  alumniRoleId: string | null,
): EventAttendanceStatus {
  const { status, byRole } = attendanceFor(event, memberRoleIds);
  if (
    status === 'required' &&
    !byRole &&
    alumniRoleId &&
    memberRoleIds.includes(alumniRoleId)
  ) {
    return 'optional';
  }
  return status;
}
