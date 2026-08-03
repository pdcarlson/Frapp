import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ATTENDANCE_REPOSITORY } from '../../domain/repositories/attendance.repository.interface';
import type { IAttendanceRepository } from '../../domain/repositories/attendance.repository.interface';
import { EVENT_REPOSITORY } from '../../domain/repositories/event.repository.interface';
import type { IEventRepository } from '../../domain/repositories/event.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import type { EventAttendance } from '../../domain/entities/event-attendance.entity';
import { RbacService } from './rbac.service';

const CHECK_IN_GRACE_PERIOD_MINUTES = 15;

@Injectable()
export class AttendanceService {
  constructor(
    @Inject(ATTENDANCE_REPOSITORY)
    private readonly attendanceRepo: IAttendanceRepository,
    @Inject(EVENT_REPOSITORY)
    private readonly eventRepo: IEventRepository,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
    private readonly rbac: RbacService,
  ) {}

  async checkIn(
    eventId: string,
    userId: string,
    chapterId: string,
  ): Promise<EventAttendance> {
    const event = await this.eventRepo.findById(eventId, chapterId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const now = new Date();
    const start = new Date(event.start_time);
    const end = new Date(event.end_time);
    const graceWindowEnd = new Date(
      end.getTime() + CHECK_IN_GRACE_PERIOD_MINUTES * 60 * 1000,
    );

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Event times are invalid');
    }

    if (now < start || now > graceWindowEnd) {
      throw new BadRequestException(
        'Check-in is only allowed during the event time window',
      );
    }

    // If the event targets specific roles, only members with matching roles can check in.
    const isRoleTargeted = Boolean(event.required_role_ids?.length);
    if (isRoleTargeted) {
      const member = await this.memberRepo.findByUserAndChapter(
        userId,
        chapterId,
      );
      if (!member) {
        throw new ForbiddenException('You are not a member of this chapter');
      }

      const hasRequiredRole = event.required_role_ids!.some((roleId) =>
        member.role_ids.includes(roleId),
      );
      if (!hasRequiredRole) {
        throw new ForbiddenException(
          'You are not eligible to check in for this event',
        );
      }
    }

    // Alumni do not check in to events or accrue attendance points
    // (`spec/behavior/alumni.md`), and the route carries no permission
    // requirement, so the lifecycle rule is enforced here. A role-targeted
    // event is an explicit chapter decision about who attends — an
    // alumni-facing event (homecoming) lists the Alumni role in
    // `required_role_ids`, and the check above already proved the caller
    // matches — so the lifecycle rule does not override it.
    if (!isRoleTargeted && (await this.rbac.isAlumni(chapterId, userId))) {
      throw new ForbiddenException(
        'Alumni members cannot check in to chapter events',
      );
    }

    const existing = await this.attendanceRepo.findByEventAndUser(
      eventId,
      userId,
    );
    if (existing) {
      throw new ConflictException('Already checked in for this event');
    }

    const checkInTime = now.toISOString();

    // Insert the attendance row and award the event's ATTENDANCE points
    // atomically in one DB transaction, so a partial failure can't leave points
    // without attendance (or attendance without points). The unique
    // (event_id, user_id) index -- enforced inside the RPC via
    // `on conflict do nothing` -- is the authoritative guard against a concurrent
    // double check-in; the duplicate read above is only a friendly fast path. A
    // lost race (the row already exists) returns null, which maps to the same
    // 409 as the fast-path guard.
    const attendance = await this.attendanceRepo.checkInAtomic(
      eventId,
      userId,
      event.chapter_id,
      checkInTime,
      event.point_value,
      event.name,
    );
    if (!attendance) {
      throw new ConflictException('Already checked in for this event');
    }

    return attendance;
  }

  async getAttendance(
    eventId: string,
    chapterId: string,
  ): Promise<EventAttendance[]> {
    const event = await this.eventRepo.findById(eventId, chapterId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    return this.attendanceRepo.findByEvent(eventId);
  }

  async updateStatus(
    eventId: string,
    userId: string,
    chapterId: string,
    status: EventAttendance['status'],
    excuseReason: string | null,
    markedBy: string,
  ): Promise<EventAttendance> {
    const event = await this.eventRepo.findById(eventId, chapterId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const attendance = await this.attendanceRepo.findByEventAndUser(
      eventId,
      userId,
    );
    if (!attendance) {
      throw new NotFoundException('Attendance record not found');
    }

    return this.attendanceRepo.update(attendance.id, {
      status,
      excuse_reason: excuseReason,
      marked_by: markedBy,
    });
  }

  async markAutoAbsent(
    eventId: string,
    chapterId: string,
  ): Promise<{ marked: number }> {
    const event = await this.eventRepo.findById(eventId, chapterId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const end = new Date(event.end_time);
    const graceEnd = new Date(
      end.getTime() + CHECK_IN_GRACE_PERIOD_MINUTES * 60 * 1000,
    );
    if (new Date() < graceEnd) {
      throw new BadRequestException(
        'Cannot mark auto-absent before the grace period ends',
      );
    }

    if (
      !event.is_mandatory &&
      (!event.required_role_ids || event.required_role_ids.length === 0)
    ) {
      return { marked: 0 };
    }

    const allMembers = await this.memberRepo.findByChapter(chapterId);

    let requiredMembers: typeof allMembers;
    if (event.required_role_ids && event.required_role_ids.length > 0) {
      const requiredRoleIdSet = new Set(event.required_role_ids);
      requiredMembers = allMembers.filter((m) =>
        m.role_ids.some((roleId) => requiredRoleIdSet.has(roleId)),
      );
    } else {
      // Alumni cannot check in to a non-targeted event and cannot self-excuse,
      // so including them here would hand every alumnus a guaranteed ABSENT
      // record on every mandatory event. A role-targeted event is filtered
      // above and keeps whoever it names, alumni included.
      const alumniRoleId = await this.rbac.getAlumniRoleId(chapterId);
      requiredMembers = alumniRoleId
        ? allMembers.filter((m) => !m.role_ids.includes(alumniRoleId))
        : allMembers;
    }

    const existingRecords = await this.attendanceRepo.findByEvent(eventId);
    const checkedInOrExcused = new Set(
      existingRecords
        .filter(
          (r) =>
            r.status === 'PRESENT' ||
            r.status === 'EXCUSED' ||
            r.status === 'LATE',
        )
        .map((r) => r.user_id),
    );
    const usersWithAttendanceRecords = new Set(
      existingRecords.map((r) => r.user_id),
    );

    const membersToMark = requiredMembers.filter((member) => {
      const isCheckedInOrExcused = checkedInOrExcused.has(member.user_id);
      const hasExistingRecord = usersWithAttendanceRecords.has(member.user_id);
      return !isCheckedInOrExcused && !hasExistingRecord;
    });

    if (membersToMark.length === 0) {
      return { marked: 0 };
    }

    const rows = membersToMark.map((member) => ({
      event_id: eventId,
      user_id: member.user_id,
      status: 'ABSENT' as const,
      check_in_time: null,
      excuse_reason: null,
      marked_by: null,
    }));

    const created = await this.attendanceRepo.createMany(rows);

    return { marked: created.length };
  }
}
