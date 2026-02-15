import { Inject, Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_REPOSITORY } from '../../domain/repositories/notification.repository.interface';
import type { INotificationRepository } from '../../domain/repositories/notification.repository.interface';
import { NOTIFICATION_PROVIDER } from '../../domain/adapters/notification.interface';
import type { INotificationProvider } from '../../domain/adapters/notification.interface';
import { Notification } from '../../domain/entities/notification.entity';

export interface NotifyPayload {
  title: string;
  body: string;
  category: 'CHAT' | 'POINTS' | 'EVENTS' | 'SYSTEM';
  data?: Record<string, unknown>;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly repo: INotificationRepository,
    @Inject(NOTIFICATION_PROVIDER)
    private readonly provider: INotificationProvider,
  ) {}

  async notifyUser(
    userId: string,
    chapterId: string,
    payload: NotifyPayload,
  ): Promise<Notification> {
    // 1. Save to In-App History
    const notification = await this.repo.create({
      userId,
      chapterId,
      title: payload.title,
      body: payload.body,
      data: payload.data || null,
      readAt: null,
    });

    // 2. Check Preferences
    const prefs = await this.repo.getPreferences(userId);
    const categoryPref = prefs.find((p) => p.category === payload.category);

    // If preference exists and is disabled, skip push
    if (categoryPref && !categoryPref.isEnabled) {
      this.logger.log(
        `Skipping push notification for user ${userId} (Category ${payload.category} disabled)`,
      );
      return notification;
    }

    // 3. Send Push
    const tokens = await this.repo.findTokensByUserId(userId);
    if (tokens.length > 0) {
      await this.provider.send({
        tokens: tokens.map((t) => t.token),
        title: payload.title,
        body: payload.body,
        data: payload.data,
      });
    }

    return notification;
  }

  async registerToken(
    userId: string,
    token: string,
    deviceName?: string,
  ): Promise<void> {
    await this.repo.upsertToken({
      userId,
      token,
      deviceName: deviceName || null,
    });
  }

  async getHistory(userId: string, limit?: number): Promise<Notification[]> {
    return this.repo.findByUser(userId, limit);
  }

  async markRead(notificationId: string): Promise<void> {
    await this.repo.markAsRead(notificationId);
  }
}
