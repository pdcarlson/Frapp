import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { EVENT_REPOSITORY } from '../../domain/repositories/event.repository.interface';
import type { IEventRepository } from '../../domain/repositories/event.repository.interface';
import { PointsService } from './points.service';
import { QrTokenService } from './qr-token.service';
import { EventAttendance } from '../../domain/entities/event.entity';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    @Inject(EVENT_REPOSITORY)
    private readonly eventRepo: IEventRepository,
    private readonly pointsService: PointsService,
    private readonly qrTokenService: QrTokenService,
  ) {}

  async processQrCheckIn(
    userId: string,
    token: string,
  ): Promise<EventAttendance> {
    const payload = this.qrTokenService.validateToken(token);
    return this.checkIn(userId, payload.chapterId, payload.eventId);
  }

  async checkIn(
    userId: string,
    chapterId: string,
    eventId: string,
  ): Promise<EventAttendance> {
    const event = await this.eventRepo.findById(eventId);

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (event.chapterId !== chapterId) {
      throw new BadRequestException('Event does not belong to this chapter');
    }

    const existing = await this.eventRepo.findAttendance(eventId, userId);
    if (existing && existing.status === 'PRESENT') {
      throw new BadRequestException('User is already checked in to this event');
    }

    this.logger.log(`User ${userId} checking into event ${eventId}`);

    // In a real database transaction would be better, but we'll use sequential ops for now
    // Drizzle transactions require passing the tx object, which would complicate the service layer pattern
    const attendance = await this.eventRepo.upsertAttendance({
      eventId,
      userId,
      status: 'PRESENT',
      checkInTime: new Date(),
    });

    if (event.pointValue > 0) {
      await this.pointsService.awardPoints(
        userId,
        chapterId,
        event.pointValue,
        'ATTENDANCE',
        `Attended ${event.name}`,
        { eventId },
      );
    }

    return attendance;
  }

  async getAttendanceForEvent(eventId: string): Promise<EventAttendance[]> {
    return this.eventRepo.findAttendanceByEvent(eventId);
  }
}
