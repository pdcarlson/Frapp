import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '../schema';
import { DRIZZLE_DB } from '../drizzle.provider';
import { IStudyRepository } from '../../../domain/repositories/study.repository.interface';
import {
  StudyGeofence,
  StudySession,
} from '../../../domain/entities/study.entity';

@Injectable()
export class DrizzleStudyRepository implements IStudyRepository {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findGeofencesByChapter(chapterId: string): Promise<StudyGeofence[]> {
    const results = await this.db
      .select()
      .from(schema.studyGeofences)
      .where(
        and(
          eq(schema.studyGeofences.chapterId, chapterId),
          eq(schema.studyGeofences.isActive, true),
        ),
      );

    return results.map(this.mapGeofence.bind(this));
  }

  async findGeofenceById(id: string): Promise<StudyGeofence | null> {
    const [result] = await this.db
      .select()
      .from(schema.studyGeofences)
      .where(eq(schema.studyGeofences.id, id))
      .limit(1);

    return result ? this.mapGeofence(result) : null;
  }

  async createGeofence(
    geofence: Omit<StudyGeofence, 'id' | 'createdAt'>,
  ): Promise<StudyGeofence> {
    const [result] = await this.db
      .insert(schema.studyGeofences)
      .values({
        chapterId: geofence.chapterId,
        name: geofence.name,
        coordinates: geofence.coordinates,
        isActive: geofence.isActive,
      })
      .returning();

    return this.mapGeofence(result);
  }

  async createSession(
    session: Omit<StudySession, 'id' | 'createdAt'>,
  ): Promise<StudySession> {
    const [result] = await this.db
      .insert(schema.studySessions)
      .values({
        chapterId: session.chapterId,
        userId: session.userId,
        geofenceId: session.geofenceId,
        status: session.status,
        startTime: session.startTime,
        endTime: session.endTime,
        lastHeartbeatAt: session.lastHeartbeatAt,
        totalMinutes: session.totalMinutes,
        pointsAwarded: session.pointsAwarded,
      })
      .returning();

    return this.mapSession(result);
  }

  async updateSession(
    id: string,
    updates: Partial<StudySession>,
  ): Promise<StudySession> {
    const [result] = await this.db
      .update(schema.studySessions)
      .set({
        ...updates,
      })
      .where(eq(schema.studySessions.id, id))
      .returning();

    return this.mapSession(result);
  }

  async findActiveSession(userId: string): Promise<StudySession | null> {
    const [result] = await this.db
      .select()
      .from(schema.studySessions)
      .where(
        and(
          eq(schema.studySessions.userId, userId),
          eq(schema.studySessions.status, 'ACTIVE'),
        ),
      )
      .limit(1);

    return result ? this.mapSession(result) : null;
  }

  async findSessionById(id: string): Promise<StudySession | null> {
    const [result] = await this.db
      .select()
      .from(schema.studySessions)
      .where(eq(schema.studySessions.id, id))
      .limit(1);

    return result ? this.mapSession(result) : null;
  }

  private mapGeofence(
    row: typeof schema.studyGeofences.$inferSelect,
  ): StudyGeofence {
    return new StudyGeofence(
      row.id,
      row.chapterId,
      row.name,
      row.coordinates as { lat: number; lng: number }[],
      row.isActive,
      row.createdAt,
    );
  }

  private mapSession(
    row: typeof schema.studySessions.$inferSelect,
  ): StudySession {
    return new StudySession(
      row.id,
      row.chapterId,
      row.userId,
      row.geofenceId,
      row.status as 'ACTIVE' | 'COMPLETED' | 'EXPIRED',
      row.startTime,
      row.endTime,
      row.lastHeartbeatAt,
      row.totalMinutes,
      row.pointsAwarded,
      row.createdAt,
    );
  }
}
