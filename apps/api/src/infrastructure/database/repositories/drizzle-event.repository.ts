import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '../schema';
import { DRIZZLE_DB } from '../drizzle.provider';
import { IEventRepository } from '../../../domain/repositories/event.repository.interface';
import { Event, EventAttendance } from '../../../domain/entities/event.entity';

@Injectable()
export class DrizzleEventRepository implements IEventRepository {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async create(event: Omit<Event, 'id' | 'createdAt'>): Promise<Event> {
    const [result] = await this.db
      .insert(schema.events)
      .values({
        chapterId: event.chapterId,
        name: event.name,
        description: event.description,
        startTime: event.startTime,
        endTime: event.endTime,
        pointValue: event.pointValue,
        isMandatory: event.isMandatory,
      })
      .returning();

    return new Event(
      result.id,
      result.chapterId,
      result.name,
      result.description,
      result.startTime,
      result.endTime,
      result.pointValue,
      result.isMandatory,
      result.createdAt,
    );
  }

  async findById(id: string): Promise<Event | null> {
    const [result] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, id))
      .limit(1);

    if (!result) return null;
    return new Event(
      result.id,
      result.chapterId,
      result.name,
      result.description,
      result.startTime,
      result.endTime,
      result.pointValue,
      result.isMandatory,
      result.createdAt,
    );
  }

  async findByChapter(chapterId: string): Promise<Event[]> {
    return this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.chapterId, chapterId))
      .then((rows) =>
        rows.map(
          (r) =>
            new Event(
              r.id,
              r.chapterId,
              r.name,
              r.description,
              r.startTime,
              r.endTime,
              r.pointValue,
              r.isMandatory,
              r.createdAt,
            ),
        ),
      );
  }

  async upsertAttendance(
    attendance: Omit<EventAttendance, 'id' | 'createdAt'>,
  ): Promise<EventAttendance> {
    const [result] = await this.db
      .insert(schema.eventAttendance)
      .values({
        eventId: attendance.eventId,
        userId: attendance.userId,
        status: attendance.status,
        checkInTime: attendance.checkInTime,
      })
      .onConflictDoUpdate({
        target: [schema.eventAttendance.eventId, schema.eventAttendance.userId],
        set: {
          status: attendance.status,
          checkInTime: attendance.checkInTime,
        },
      })
      .returning();

    return new EventAttendance(
      result.id,
      result.eventId,
      result.userId,
      result.status,
      result.checkInTime,
      result.createdAt,
    );
  }

  async findAttendance(
    eventId: string,
    userId: string,
  ): Promise<EventAttendance | null> {
    const [result] = await this.db
      .select()
      .from(schema.eventAttendance)
      .where(
        and(
          eq(schema.eventAttendance.eventId, eventId),
          eq(schema.eventAttendance.userId, userId),
        ),
      )
      .limit(1);

    if (!result) return null;
    return new EventAttendance(
      result.id,
      result.eventId,
      result.userId,
      result.status,
      result.checkInTime,
      result.createdAt,
    );
  }

  async findAttendanceByEvent(eventId: string): Promise<EventAttendance[]> {
    return this.db
      .select()
      .from(schema.eventAttendance)
      .where(eq(schema.eventAttendance.eventId, eventId))
      .then((rows) =>
        rows.map(
          (r) =>
            new EventAttendance(
              r.id,
              r.eventId,
              r.userId,
              r.status,
              r.checkInTime,
              r.createdAt,
            ),
        ),
      );
  }
}
