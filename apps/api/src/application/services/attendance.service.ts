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
import { POINT_TRANSACTION_REPOSITORY } from '../../domain/repositories/point-transaction.repository.interface';
import type { IPointTransactionRepository } from '../../domain/repositories/point-transaction.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import type { EventAttendance } from '../../domain/entities/event-attendance.entity';

const CHECK_IN_GRACE_PERIOD_MINUTES = 15;

@Injectable()
export class AttendanceService {
  constructor(
    @Inject(ATTENDANCE_REPOSITORY)
    private readonly attendanceRepo: IAttendanceRepository,
    @Inject(EVENT_REPOSITORY)
    private readonly eventRepo: IEventRepository,
    @Inject(POINT_TRANSACTION_REPOSITORY)
    private readonly pointTxnRepo: IPointTransactionRepository,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
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
    if (event.required_role_ids && event.required_role_ids.length > 0) {
      const member = await this.memberRepo.findByUserAndChapter(
        userId,
        chapterId,
      );
      if (!member) {
        throw new ForbiddenException('You are not a member of this chapter');
      }

      const hasRequiredRole = event.required_role_ids.some((roleId) =>
        member.role_ids.includes(roleId),
      );
      if (!hasRequiredRole) {
        throw new ForbiddenException(
          'You are not eligible to check in for this event',
        );
      }
    }

    const existing = await this.attendanceRepo.findByEventAndUser(
      eventId,
      userId,
    );
    if (existing) {
      throw new ConflictException('Already checked in for this event');
    }

    const checkInTime = now.toISOString();

    let attendance: EventAttendance | null = null;
    try {
      attendance = await this.attendanceRepo.create({
        event_id: eventId,
        user_id: userId,
        status: 'PRESENT',
        check_in_time: checkInTime,
        excuse_reason: null,
        marked_by: null,
      });

      await this.pointTxnRepo.create({
        chapter_id: event.chapter_id,
        user_id: userId,
        amount: event.point_value,
        category: 'ATTENDANCE',
        description: `Attendance for event: ${event.name}`,
        metadata: {
          event_id: event.id,
        },
      });

      return attendance;
    } catch (error) {
      // Best-effort rollback of attendance if points creation fails.
      if (attendance) {
        try {
          await this.attendanceRepo.delete(attendance.id);
        } catch {
          // swallow rollback error
        }
      }
      throw error;
    }
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
      requiredMembers = allMembers;
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
