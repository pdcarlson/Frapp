import {
  BadRequestException,
  ConflictException,
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
import type { EventAttendance } from '../../domain/entities/event-attendance.entity';

@Injectable()
export class AttendanceService {
  constructor(
    @Inject(ATTENDANCE_REPOSITORY)
    private readonly attendanceRepo: IAttendanceRepository,
    @Inject(EVENT_REPOSITORY)
    private readonly eventRepo: IEventRepository,
    @Inject(POINT_TRANSACTION_REPOSITORY)
    private readonly pointTxnRepo: IPointTransactionRepository,
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

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Event times are invalid');
    }

    if (now < start || now > end) {
      throw new BadRequestException(
        'Check-in is only allowed during the event time window',
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
          await this.attendanceRepo.update(attendance.id, {
            status: 'ABSENT',
          });
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
}
