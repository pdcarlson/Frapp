import {
  Notification,
  PushToken,
  NotificationPreference,
} from '../entities/notification.entity';

export const NOTIFICATION_REPOSITORY = 'NOTIFICATION_REPOSITORY';

export interface INotificationRepository {
  // Push Tokens
  upsertToken(token: Omit<PushToken, 'id' | 'createdAt'>): Promise<PushToken>;
  findTokensByUserId(userId: string): Promise<PushToken[]>;
  findTokensByUserIds(userIds: string[]): Promise<PushToken[]>;
  deleteToken(token: string): Promise<void>;

  // Notification History
  create(
    notification: Omit<Notification, 'id' | 'createdAt'>,
  ): Promise<Notification>;
  createMany(
    notifications: Omit<Notification, 'id' | 'createdAt'>[],
  ): Promise<Notification[]>;
  findByUser(userId: string, limit?: number): Promise<Notification[]>;
  markAsRead(id: string): Promise<void>;

  // Preferences
  getPreferences(userId: string): Promise<NotificationPreference[]>;
  updatePreference(
    userId: string,
    category: string,
    isEnabled: boolean,
  ): Promise<void>;
}
