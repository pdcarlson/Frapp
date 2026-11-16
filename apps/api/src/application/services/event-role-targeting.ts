import { NotFoundException } from '@nestjs/common';
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

/** A member as the read gate needs them, already resolved. */
export interface EventViewer {
  permissions: ReadonlySet<string>;
  role_ids: readonly string[];
}

/**
 * The read gate for a member whose permissions and roles are already in
 * hand, with no lookups: the one statement of the rule. An event that invites
 * everyone is visible to every member; one that leaves anyone out, to a
 * holder of `events:update` (or the wildcard) and to the members it invites.
 * Every read path answers through it: {@link isEventVisibleTo} for one event,
 * {@link filterVisibleEvents} for a list, and a caller checking many members
 * at once (`EventService.visibleToAll`) directly.
 */
export function isEventVisibleWith(
  event: EventAttendanceFields,
  viewer: EventViewer,
): boolean {
  if (!eventLimitsAudience(event)) return true;
  if (
    viewer.permissions.has('*') ||
    viewer.permissions.has(SystemPermissions.EVENTS_UPDATE)
  ) {
    return true;
  }
  return isInvited(event, viewer.role_ids);
}

/** What resolving a viewer reads: the caller's own RBAC service and member repository. */
export interface EventViewerLookups {
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
}

const NO_PERMISSIONS: ReadonlySet<string> = new Set();
const MANAGES_EVENTS: ReadonlySet<string> = new Set([
  SystemPermissions.EVENTS_UPDATE,
]);

/**
 * `userId` as {@link isEventVisibleWith} reads them, or `null` for someone who
 * is not a member and holds no `events:update`. `memberHasAnyPermission`
 * counts the wildcard, so its yes stands for both; the member row is read
 * only when it says no.
 */
async function resolveEventViewer(
  chapterId: string,
  userId: string,
  lookups: EventViewerLookups,
): Promise<EventViewer | null> {
  if (
    await lookups.rbac.memberHasAnyPermission(chapterId, userId, [
      SystemPermissions.EVENTS_UPDATE,
    ])
  ) {
    return { permissions: MANAGES_EVENTS, role_ids: [] };
  }
  const member = await lookups.memberRepo.findByUserAndChapter(
    userId,
    chapterId,
  );
  return member
    ? { permissions: NO_PERMISSIONS, role_ids: member.role_ids }
    : null;
}

/**
 * Whether `userId` may see `event` through the read routes
 * (`spec/behavior/events.md` § Attendance by role), by
 * {@link isEventVisibleWith}. A caller that can't see an event gets the same
 * 404 a nonexistent id does, so no response confirms a role-targeted event
 * exists. Someone who is not a member of the chapter sees no event that
 * limits its audience. No lookups when the event invites everyone.
 */
export async function isEventVisibleTo(
  event: EventAttendanceFields,
  chapterId: string,
  userId: string,
  lookups: EventViewerLookups,
): Promise<boolean> {
  if (!eventLimitsAudience(event)) return true;
  const viewer = await resolveEventViewer(chapterId, userId, lookups);
  return !!viewer && isEventVisibleWith(event, viewer);
}

/**
 * `event` when `userId` may see it (`isEventVisibleTo`), else the same
 * `Event not found` 404 a missing event (`null`) gets.
 */
export async function visibleEventOrNotFound<E extends EventAttendanceFields>(
  event: E | null,
  chapterId: string,
  userId: string,
  lookups: EventViewerLookups,
): Promise<E> {
  if (!event || !(await isEventVisibleTo(event, chapterId, userId, lookups))) {
    throw new NotFoundException('Event not found');
  }
  return event;
}

/**
 * `events` narrowed to those `userId` may see, by {@link isEventVisibleWith}:
 * the list, the creator's list and search. The permission and member row are
 * read once for the whole list, and not at all when no event limits its
 * audience. A caller with no member row is read as holding no roles.
 */
export async function filterVisibleEvents<E extends EventAttendanceFields>(
  events: E[],
  chapterId: string,
  userId: string,
  lookups: EventViewerLookups,
): Promise<E[]> {
  if (!events.some(eventLimitsAudience)) return events;
  const viewer = (await resolveEventViewer(chapterId, userId, lookups)) ?? {
    permissions: NO_PERMISSIONS,
    role_ids: [],
  };
  return events.filter((event) => isEventVisibleWith(event, viewer));
}
