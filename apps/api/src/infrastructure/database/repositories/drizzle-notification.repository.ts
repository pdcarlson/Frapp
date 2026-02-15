import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, inArray, desc } from 'drizzle-orm';
import * as schema from '../schema';
import { DRIZZLE_DB } from '../drizzle.provider';
import { INotificationRepository } from '../../../domain/repositories/notification.repository.interface';
import {
  Notification,
  PushToken,
  NotificationPreference,
} from '../../../domain/entities/notification.entity';

@Injectable()
export class DrizzleNotificationRepository implements INotificationRepository {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async upsertToken(
    token: Omit<PushToken, 'id' | 'createdAt'>,
  ): Promise<PushToken> {
    const [result] = await this.db
      .insert(schema.pushTokens)
      .values({
        userId: token.userId,
        token: token.token,
        deviceName: token.deviceName,
      })
      .onConflictDoUpdate({
        target: schema.pushTokens.token,
        set: {
          userId: token.userId,
          deviceName: token.deviceName,
        },
      })
      .returning();

    return new PushToken(
      result.id,
      result.userId,
      result.token,
      result.deviceName,
      result.createdAt,
    );
  }

  async findTokensByUserId(userId: string): Promise<PushToken[]> {
    const results = await this.db
      .select()
      .from(schema.pushTokens)
      .where(eq(schema.pushTokens.userId, userId));

    return results.map(
      (r) => new PushToken(r.id, r.userId, r.token, r.deviceName, r.createdAt),
    );
  }

  async findTokensByUserIds(userIds: string[]): Promise<PushToken[]> {
    if (userIds.length === 0) return [];
    const results = await this.db
      .select()
      .from(schema.pushTokens)
      .where(inArray(schema.pushTokens.userId, userIds));

    return results.map(
      (r) => new PushToken(r.id, r.userId, r.token, r.deviceName, r.createdAt),
    );
  }

  async deleteToken(token: string): Promise<void> {
    await this.db
      .delete(schema.pushTokens)
      .where(eq(schema.pushTokens.token, token));
  }

  async create(
    notification: Omit<Notification, 'id' | 'createdAt'>,
  ): Promise<Notification> {
    const [result] = await this.db
      .insert(schema.notifications)
      .values({
        userId: notification.userId,
        chapterId: notification.chapterId,
        title: notification.title,
        body: notification.body,
        data: notification.data,
      })
      .returning();

    return new Notification(
      result.id,
      result.userId,
      result.chapterId,
      result.title,
      result.body,
      result.data as Record<string, unknown> | null,
      result.readAt,
      result.createdAt,
    );
  }

  async createMany(
    notifications: Omit<Notification, 'id' | 'createdAt'>[],
  ): Promise<Notification[]> {
    if (notifications.length === 0) return [];
    const results = await this.db
      .insert(schema.notifications)
      .values(
        notifications.map((n) => ({
          userId: n.userId,
          chapterId: n.chapterId,
          title: n.title,
          body: n.body,
          data: n.data,
        })),
      )
      .returning();

    return results.map(
      (result) =>
        new Notification(
          result.id,
          result.userId,
          result.chapterId,
          result.title,
          result.body,
          result.data as Record<string, unknown> | null,
          result.readAt,
          result.createdAt,
        ),
    );
  }

  async findByUser(
    userId: string,
    limit: number = 50,
  ): Promise<Notification[]> {
    const results = await this.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(limit);

    return results.map(
      (result) =>
        new Notification(
          result.id,
          result.userId,
          result.chapterId,
          result.title,
          result.body,
          result.data as Record<string, unknown> | null,
          result.readAt,
          result.createdAt,
        ),
    );
  }

  async markAsRead(id: string): Promise<void> {
    await this.db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(eq(schema.notifications.id, id));
  }

  async getPreferences(userId: string): Promise<NotificationPreference[]> {
    const results = await this.db
      .select()
      .from(schema.notificationPreferences)
      .where(eq(schema.notificationPreferences.userId, userId));

    return results.map(
      (r) =>
        new NotificationPreference(
          r.id,
          r.userId,
          r.category,
          r.isEnabled,
          r.updatedAt,
        ),
    );
  }

  async updatePreference(
    userId: string,
    category: string,
    isEnabled: boolean,
  ): Promise<void> {
    await this.db
      .insert(schema.notificationPreferences)
      .values({
        userId,
        category,
        isEnabled,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          schema.notificationPreferences.userId,
          schema.notificationPreferences.category,
        ],
        set: {
          isEnabled,
          updatedAt: new Date(),
        },
      });
  }
}
