import { Inject, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { NOTIFICATION_REPOSITORY } from '../../domain/repositories/notification.repository.interface';
import type { INotificationRepository } from '../../domain/repositories/notification.repository.interface';
import { PUSH_TOKEN_REPOSITORY } from '../../domain/repositories/notification.repository.interface';
import type { IPushTokenRepository } from '../../domain/repositories/notification.repository.interface';
import { NOTIFICATION_PREFERENCE_REPOSITORY } from '../../domain/repositories/notification.repository.interface';
import type { INotificationPreferenceRepository } from '../../domain/repositories/notification.repository.interface';
import { USER_SETTINGS_REPOSITORY } from '../../domain/repositories/notification.repository.interface';
import type { IUserSettingsRepository } from '../../domain/repositories/notification.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { NOTIFICATION_PROVIDER } from '../../domain/adapters/notification.interface';
import type { INotificationProvider } from '../../domain/adapters/notification.interface';
import type {
  Notification,
  PushToken,
  NotificationPreference,
  UserSettings,
} from '../../domain/entities/notification.entity';

export type NotifyPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority?: 'URGENT' | 'NORMAL' | 'SILENT';
  category?: string;
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notificationRepo: INotificationRepository,
    @Inject(PUSH_TOKEN_REPOSITORY)
    private readonly pushTokenRepo: IPushTokenRepository,
    @Inject(NOTIFICATION_PREFERENCE_REPOSITORY)
    private readonly preferenceRepo: INotificationPreferenceRepository,
    @Inject(USER_SETTINGS_REPOSITORY)
    private readonly settingsRepo: IUserSettingsRepository,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
    @Inject(NOTIFICATION_PROVIDER)
    private readonly pushProvider: INotificationProvider,
  ) {}

  async notifyUser(
    userId: string,
    chapterId: string,
    payload: NotifyPayload,
  ): Promise<void> {
    const category = payload.category ?? 'default';

    const pref = await this.preferenceRepo.findByUserChapterCategory(
      userId,
      chapterId,
      category,
    );
    if (pref && !pref.is_enabled) {
      return;
    }

    const settings = await this.settingsRepo.findByUser(userId);
    let effectivePriority = payload.priority ?? 'NORMAL';
    if (effectivePriority !== 'URGENT' && this.isInQuietHours(settings)) {
      effectivePriority = 'SILENT';
    }

    const notification = await this.notificationRepo.create({
      chapter_id: chapterId,
      user_id: userId,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
    });

    const pushTokens = await this.pushTokenRepo.findByUser(userId);
    if (pushTokens.length === 0) return;

    try {
      await this.pushProvider.sendToUser(
        pushTokens.map((t) => t.token),
        {
          title: payload.title,
          body: payload.body,
          data: { ...payload.data, notificationId: notification.id },
          priority: effectivePriority,
        },
      );
    } catch (err) {
      this.logger.warn(`Push delivery failed for user ${userId}`, err);
    }
  }

  async notifyChapter(
    chapterId: string,
    payload: NotifyPayload,
  ): Promise<void> {
    const members = await this.memberRepo.findByChapter(chapterId);
    await Promise.allSettled(
      members.map((member) =>
        this.notifyUser(member.user_id, chapterId, payload),
      ),
    );
  }

  private isInQuietHours(settings: UserSettings | null): boolean {
    if (!settings?.quiet_hours_start || !settings?.quiet_hours_end) {
      return false;
    }

    const tz = settings.quiet_hours_tz ?? 'UTC';
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(
      parts.find((p) => p.type === 'hour')?.value ?? '0',
      10,
    );
    const minute = parseInt(
      parts.find((p) => p.type === 'minute')?.value ?? '0',
      10,
    );
    const currentMinutes = hour * 60 + minute;

    const [startH, startM] = settings.quiet_hours_start
      .split(':')
      .map((s) => parseInt(s, 10));
    const [endH, endM] = settings.quiet_hours_end
      .split(':')
      .map((s) => parseInt(s, 10));
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes > endMinutes) {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  async listNotifications(
    userId: string,
    options?: { limit?: number },
  ): Promise<Notification[]> {
    return this.notificationRepo.findByUser(userId, options);
  }

  async markNotificationRead(
    id: string,
    userId: string,
  ): Promise<Notification> {
    const existing = await this.notificationRepo.findById(id);
    if (!existing || existing.user_id !== userId) {
      throw new NotFoundException('Notification not found');
    }
    return this.notificationRepo.markRead(id, userId);
  }

  async registerPushToken(
    userId: string,
    token: string,
    deviceName?: string,
  ): Promise<PushToken> {
    const existing = await this.pushTokenRepo.findByToken(token);
    if (existing) {
      if (existing.user_id === userId) {
        return existing;
      }
      await this.pushTokenRepo.deleteByToken(token);
    }

    return this.pushTokenRepo.create({
      user_id: userId,
      token,
      device_name: deviceName ?? null,
    });
  }

  async removePushToken(id: string, userId: string): Promise<void> {
    const existing = await this.pushTokenRepo.findById(id);
    if (!existing || existing.user_id !== userId) {
      throw new NotFoundException('Push token not found');
    }
    await this.pushTokenRepo.delete(id, userId);
  }

  async getPreferences(
    userId: string,
    chapterId: string,
  ): Promise<NotificationPreference[]> {
    return this.preferenceRepo.findByUserAndChapter(userId, chapterId);
  }

  async updatePreference(
    userId: string,
    chapterId: string,
    category: string,
    isEnabled: boolean,
  ): Promise<NotificationPreference> {
    return this.preferenceRepo.upsert({
      user_id: userId,
      chapter_id: chapterId,
      category,
      is_enabled: isEnabled,
    });
  }

  async getSettings(userId: string): Promise<UserSettings | null> {
    return this.settingsRepo.findByUser(userId);
  }

  async updateSettings(
    userId: string,
    data: Partial<
      Pick<
        UserSettings,
        'quiet_hours_start' | 'quiet_hours_end' | 'quiet_hours_tz' | 'theme'
      >
    >,
  ): Promise<UserSettings> {
    const existing = await this.settingsRepo.findByUser(userId);
    return this.settingsRepo.upsert({
      user_id: userId,
      quiet_hours_start:
        data.quiet_hours_start ?? existing?.quiet_hours_start ?? null,
      quiet_hours_end:
        data.quiet_hours_end ?? existing?.quiet_hours_end ?? null,
      quiet_hours_tz: data.quiet_hours_tz ?? existing?.quiet_hours_tz ?? null,
      theme: data.theme ?? existing?.theme ?? 'system',
    });
  }
}
