import {
  eventAttendanceFor,
  type EventAttendance,
  type EventAttendanceFields,
} from '@repo/validation';

/**
 * `spec/behavior/events.md` § Attendance by role. The API's one door to the
 * rule in `@repo/validation` (`event-attendance.ts`): who an event is for,
 * read the same way by the read gate (list, detail, `.ics`, search, feed),
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
