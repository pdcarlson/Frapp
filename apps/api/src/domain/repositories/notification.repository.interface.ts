import type {
  Notification,
  PushToken,
  NotificationPreference,
  UserSettings,
} from '../entities/notification.entity';

export const NOTIFICATION_REPOSITORY = 'NOTIFICATION_REPOSITORY';
export const PUSH_TOKEN_REPOSITORY = 'PUSH_TOKEN_REPOSITORY';
export const NOTIFICATION_PREFERENCE_REPOSITORY =
  'NOTIFICATION_PREFERENCE_REPOSITORY';
export const USER_SETTINGS_REPOSITORY = 'USER_SETTINGS_REPOSITORY';

export interface INotificationRepository {
  create(data: Partial<Notification>): Promise<Notification>;
  createMany(data: Partial<Notification>[]): Promise<Notification[]>;
  findByUser(
    userId: string,
    chapterId: string,
    options?: { limit?: number },
  ): Promise<Notification[]>;
  findById(id: string, chapterId: string): Promise<Notification | null>;
  markRead(
    id: string,
    userId: string,
    chapterId: string,
  ): Promise<Notification>;
}

export interface IPushTokenRepository {
  create(data: Partial<PushToken>): Promise<PushToken>;
  findByUser(userId: string): Promise<PushToken[]>;
  findByUserIds(userIds: string[]): Promise<PushToken[]>;
  findById(id: string): Promise<PushToken | null>;
  findByToken(token: string): Promise<PushToken | null>;
  delete(id: string, userId: string): Promise<void>;
  deleteByToken(token: string): Promise<void>;
}

export interface INotificationPreferenceRepository {
  findByUserAndChapter(
    userId: string,
    chapterId: string,
  ): Promise<NotificationPreference[]>;
  upsert(
    data: Partial<NotificationPreference>,
  ): Promise<NotificationPreference>;
  findByUserChapterCategory(
    userId: string,
    chapterId: string,
    category: string,
  ): Promise<NotificationPreference | null>;
  findByUsersChapterCategory(
    userIds: string[],
    chapterId: string,
    category: string,
  ): Promise<NotificationPreference[]>;
}

export interface IUserSettingsRepository {
  findByUser(userId: string): Promise<UserSettings | null>;
  findByUserIds(userIds: string[]): Promise<UserSettings[]>;
  upsert(data: Partial<UserSettings>): Promise<UserSettings>;
}
