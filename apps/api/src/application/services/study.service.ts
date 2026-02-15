import {
  Inject,
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { STUDY_REPOSITORY } from '../../domain/repositories/study.repository.interface';
import type { IStudyRepository } from '../../domain/repositories/study.repository.interface';
import { GeoService } from './geo.service';
import { PointsService } from './points.service';
import { NotificationService } from './notification.service';
import {
  StudySession,
  StudyGeofence,
} from '../../domain/entities/study.entity';

@Injectable()
export class StudyService {
  private readonly logger = new Logger(StudyService.name);

  constructor(
    @Inject(STUDY_REPOSITORY)
    private readonly studyRepo: IStudyRepository,
    private readonly geoService: GeoService,
    private readonly pointsService: PointsService,
    private readonly notificationService: NotificationService,
  ) {}

  async getGeofences(chapterId: string): Promise<StudyGeofence[]> {
    return this.studyRepo.findGeofencesByChapter(chapterId);
  }

  async startSession(
    userId: string,
    chapterId: string,
    geofenceId: string,
    lat: number,
    lng: number,
  ): Promise<StudySession> {
    const geofence = await this.studyRepo.findGeofenceById(geofenceId);
    if (!geofence || !geofence.isActive)
      throw new NotFoundException('Geofence not found or inactive');

    const isInside = this.geoService.isPointInPolygon(
      { lat, lng },
      geofence.coordinates,
    );
    if (!isInside)
      throw new BadRequestException('You are not within the study location');

    const activeSession = await this.studyRepo.findActiveSession(userId);
    if (activeSession)
      throw new BadRequestException('You already have an active session');

    return this.studyRepo.createSession({
      chapterId,
      userId,
      geofenceId,
      status: 'ACTIVE',
      startTime: new Date(),
      endTime: null,
      lastHeartbeatAt: new Date(),
      totalMinutes: 0,
      pointsAwarded: false,
    });
  }

  async processHeartbeat(
    userId: string,
    lat: number,
    lng: number,
  ): Promise<void> {
    const session = await this.studyRepo.findActiveSession(userId);
    if (!session) return; // Silent fail if no session

    const geofence = await this.studyRepo.findGeofenceById(session.geofenceId);
    if (!geofence) return;

    const isInside = this.geoService.isPointInPolygon(
      { lat, lng },
      geofence.coordinates,
    );

    if (isInside) {
      await this.studyRepo.updateSession(session.id, {
        lastHeartbeatAt: new Date(),
      });
    } else {
      this.logger.log(
        `User ${userId} left study zone. Expiring session ${session.id}`,
      );
      await this.studyRepo.updateSession(session.id, {
        status: 'EXPIRED',
        endTime: new Date(),
      });
      await this.notificationService.notifyUser(userId, session.chapterId, {
        title: 'Study Session Expired',
        body: 'You left the designated study area.',
        category: 'EVENTS',
      });
    }
  }

  async stopSession(userId: string): Promise<StudySession> {
    const session = await this.studyRepo.findActiveSession(userId);
    if (!session) throw new NotFoundException('No active session found');

    const endTime = new Date();
    const durationMs = endTime.getTime() - session.startTime.getTime();
    const totalMinutes = Math.floor(durationMs / 60000);

    let updatedSession = await this.studyRepo.updateSession(session.id, {
      status: 'COMPLETED',
      endTime,
      totalMinutes,
    });

    // Reward Logic: 1 point per 30 mins, minimum 15 mins
    if (totalMinutes >= 15) {
      const points = Math.floor(totalMinutes / 30) || 1; // At least 1 point if >15 mins
      await this.pointsService.awardPoints(
        userId,
        session.chapterId,
        points,
        'ACADEMIC',
        `Completed ${totalMinutes}m study session`,
        { sessionId: session.id },
      );
      updatedSession = await this.studyRepo.updateSession(session.id, {
        pointsAwarded: true,
      });
    }

    return updatedSession;
  }
}
