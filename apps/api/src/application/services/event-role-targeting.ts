import {
  eventAttendanceFor,
  eventLimitsAudience,
  type EventAttendance,
  type EventAttendanceFields,
  type EventAttendanceStatus,
} from '@repo/validation';
import { SystemPermissions } from '#domain/constants/permissions';

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
 * Whether check-in admits a member (`AttendanceService.checkIn`, which says
 * which step refused): the event invites them, and an alumnus only through a
 * role the event names (`spec/behavior/alumni.md`). Activity reads it for the
 * caller's own rows and for the count of who can check in (#4792); `checkIn`
 * keeps its steps apart because each refusal is logged with its own reason.
 */
export function checkInAdmits(
  event: EventAttendanceFields,
  memberRoleIds: readonly string[],
  isAlumni: boolean,
): boolean {
  const { status, byRole } = attendanceFor(event, memberRoleIds);
  return status !== 'not_invited' && (!isAlumni || byRole);
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

/**
 * Whether `userId` may see `event` through the read routes
 * (`spec/behavior/events.md` § Attendance by role): an event that invites
 * everyone is visible to every member; one that leaves anyone out, to an
 * `events:update` holder and to the members it invites. A caller that can't
 * see an event gets the same 404 a nonexistent id does, so no response
 * confirms a role-targeted event exists.
 *
 * The single-event form of the rule: `GET /v1/events/:id`
 * (`EventService.findById`) and `GET /v1/events/:id/attendance/me`
 * (`AttendanceService.getMyAttendance`) both answer through it. The list
 * (`EventService.findByChapter`) and search (`SearchService.filterVisibleEvents`)
 * apply the same rule in batch form, reading the permission and member row
 * once for many events, so a change to the rule lands in all three.
 */
export async function isEventVisibleTo(
  event: EventAttendanceFields,
  chapterId: string,
  userId: string,
  deps: {
    rbac: {
      memberHasAnyPermission(
        chapterId: string,
        userId: string,
        permissions: string[],
      ): Promise<boolean>;
    };
    memberRepo: {
      findByUserAndChapter(
        userId: string,
        chapterId: string,
      ): Promise<{ role_ids: string[] } | null>;
    };
  },
): Promise<boolean> {
  if (!eventLimitsAudience(event)) return true;
  if (
    await deps.rbac.memberHasAnyPermission(chapterId, userId, [
      SystemPermissions.EVENTS_UPDATE,
    ])
  ) {
    return true;
  }
  const member = await deps.memberRepo.findByUserAndChapter(userId, chapterId);
  return !!member && isInvited(event, member.role_ids);
}
