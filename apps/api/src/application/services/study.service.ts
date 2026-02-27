import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { STUDY_GEOFENCE_REPOSITORY } from '../../domain/repositories/study.repository.interface';
import type { IStudyGeofenceRepository } from '../../domain/repositories/study.repository.interface';
import { STUDY_SESSION_REPOSITORY } from '../../domain/repositories/study.repository.interface';
import type { IStudySessionRepository } from '../../domain/repositories/study.repository.interface';
import { POINT_TRANSACTION_REPOSITORY } from '../../domain/repositories/point-transaction.repository.interface';
import type { IPointTransactionRepository } from '../../domain/repositories/point-transaction.repository.interface';
import type {
  StudyGeofence,
  StudySession,
  GeofenceCoordinate,
} from '../../domain/entities/study.entity';

const HEARTBEAT_STALE_MINUTES = 10;
const MS_PER_MINUTE = 60 * 1000;

/**
 * Ray-casting point-in-polygon algorithm.
 * Coordinates are array of {lat, lng} forming a closed polygon.
 */
export function pointInPolygon(
  lat: number,
  lng: number,
  polygon: GeofenceCoordinate[],
): boolean {
  if (!polygon || polygon.length < 3) return false;

  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;

    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

@Injectable()
export class StudyService {
  constructor(
    @Inject(STUDY_GEOFENCE_REPOSITORY)
    private readonly geofenceRepo: IStudyGeofenceRepository,
    @Inject(STUDY_SESSION_REPOSITORY)
    private readonly sessionRepo: IStudySessionRepository,
    @Inject(POINT_TRANSACTION_REPOSITORY)
    private readonly pointTxnRepo: IPointTransactionRepository,
  ) {}

  async listGeofences(chapterId: string): Promise<StudyGeofence[]> {
    return this.geofenceRepo.findByChapter(chapterId);
  }

  async createGeofence(
    chapterId: string,
    data: {
      name: string;
      coordinates: GeofenceCoordinate[];
      is_active?: boolean;
      minutes_per_point?: number;
      points_per_interval?: number;
      min_session_minutes?: number;
    },
  ): Promise<StudyGeofence> {
    if (!data.coordinates || data.coordinates.length < 3) {
      throw new BadRequestException(
        'Coordinates must form a polygon with at least 3 points',
      );
    }
    return this.geofenceRepo.create({
      chapter_id: chapterId,
      name: data.name,
      coordinates: data.coordinates,
      is_active: data.is_active ?? true,
      minutes_per_point: data.minutes_per_point ?? 30,
      points_per_interval: data.points_per_interval ?? 1,
      min_session_minutes: data.min_session_minutes ?? 15,
    });
  }

  async updateGeofence(
    id: string,
    chapterId: string,
    data: Partial<{
      name: string;
      coordinates: GeofenceCoordinate[];
      is_active: boolean;
      minutes_per_point: number;
      points_per_interval: number;
      min_session_minutes: number;
    }>,
  ): Promise<StudyGeofence> {
    const existing = await this.geofenceRepo.findById(id, chapterId);
    if (!existing) {
      throw new NotFoundException('Geofence not found');
    }
    if (data.coordinates !== undefined && data.coordinates.length < 3) {
      throw new BadRequestException(
        'Coordinates must form a polygon with at least 3 points',
      );
    }
    return this.geofenceRepo.update(id, chapterId, data);
  }

  async deleteGeofence(id: string, chapterId: string): Promise<void> {
    const existing = await this.geofenceRepo.findById(id, chapterId);
    if (!existing) {
      throw new NotFoundException('Geofence not found');
    }
    await this.geofenceRepo.delete(id, chapterId);
  }

  async startSession(
    userId: string,
    chapterId: string,
    geofenceId: string,
    lat: number,
    lng: number,
  ): Promise<StudySession> {
    const geofence = await this.geofenceRepo.findById(geofenceId, chapterId);
    if (!geofence) {
      throw new NotFoundException('Geofence not found');
    }
    if (!geofence.is_active) {
      throw new BadRequestException('Geofence is not active');
    }

    const inside = pointInPolygon(lat, lng, geofence.coordinates);
    if (!inside) {
      throw new BadRequestException('Location is outside the geofence');
    }

    const activeSession = await this.sessionRepo.findActiveByUserAndChapter(
      userId,
      chapterId,
    );
    if (activeSession) {
      throw new ConflictException(
        'You already have an active study session. Stop it before starting a new one.',
      );
    }

    const now = new Date().toISOString();
    return this.sessionRepo.create({
      chapter_id: chapterId,
      user_id: userId,
      geofence_id: geofenceId,
      status: 'ACTIVE',
      start_time: now,
      end_time: null,
      last_heartbeat_at: now,
      total_foreground_minutes: 0,
      points_awarded: false,
    });
  }

  async heartbeat(
    userId: string,
    chapterId: string,
    lat: number,
    lng: number,
  ): Promise<StudySession> {
    const session = await this.sessionRepo.findActiveByUserAndChapter(
      userId,
      chapterId,
    );
    if (!session) {
      throw new NotFoundException('No active study session found');
    }

    const geofence = await this.geofenceRepo.findById(
      session.geofence_id,
      chapterId,
    );
    if (!geofence) {
      throw new NotFoundException('Geofence not found');
    }

    const now = new Date();
    const lastHeartbeat = new Date(session.last_heartbeat_at);
    const staleMinutes =
      (now.getTime() - lastHeartbeat.getTime()) / MS_PER_MINUTE;

    if (staleMinutes > HEARTBEAT_STALE_MINUTES) {
      return this.sessionRepo.update(session.id, {
        status: 'EXPIRED',
        end_time: now.toISOString(),
      });
    }

    const inside = pointInPolygon(lat, lng, geofence.coordinates);
    if (!inside) {
      return this.sessionRepo.update(session.id, {
        status: 'LOCATION_INVALID',
        end_time: now.toISOString(),
      });
    }

    const minutesToAdd = Math.floor(staleMinutes);
    const newTotal = session.total_foreground_minutes + minutesToAdd;

    return this.sessionRepo.update(session.id, {
      last_heartbeat_at: now.toISOString(),
      total_foreground_minutes: newTotal,
    });
  }

  async stopSession(userId: string, chapterId: string): Promise<StudySession> {
    const session = await this.sessionRepo.findActiveByUserAndChapter(
      userId,
      chapterId,
    );
    if (!session) {
      throw new NotFoundException('No active study session found');
    }

    const geofence = await this.geofenceRepo.findById(
      session.geofence_id,
      chapterId,
    );
    if (!geofence) {
      throw new NotFoundException('Geofence not found');
    }

    const now = new Date();
    const lastHeartbeat = new Date(session.last_heartbeat_at);
    const staleMinutes =
      (now.getTime() - lastHeartbeat.getTime()) / MS_PER_MINUTE;

    if (staleMinutes > HEARTBEAT_STALE_MINUTES) {
      return this.sessionRepo.update(session.id, {
        status: 'EXPIRED',
        end_time: now.toISOString(),
      });
    }

    const finalMinutes = Math.floor(staleMinutes);
    const totalMinutes = session.total_foreground_minutes + finalMinutes;

    let points = 0;
    if (
      totalMinutes >= geofence.min_session_minutes &&
      !session.points_awarded
    ) {
      points =
        Math.floor(totalMinutes / geofence.minutes_per_point) *
        geofence.points_per_interval;

      if (points > 0) {
        await this.pointTxnRepo.create({
          chapter_id: chapterId,
          user_id: userId,
          amount: points,
          category: 'STUDY',
          description: `Study session: ${geofence.name}`,
          metadata: {
            study_session_id: session.id,
            geofence_id: session.geofence_id,
            total_minutes: totalMinutes,
          },
        });
      }
    }

    return this.sessionRepo.update(session.id, {
      status: 'COMPLETED',
      end_time: now.toISOString(),
      last_heartbeat_at: now.toISOString(),
      total_foreground_minutes: totalMinutes,
      points_awarded: points > 0 || session.points_awarded,
    });
  }

  async listSessions(
    userId: string,
    chapterId: string,
  ): Promise<StudySession[]> {
    return this.sessionRepo.findByUserAndChapter(userId, chapterId);
  }
}
