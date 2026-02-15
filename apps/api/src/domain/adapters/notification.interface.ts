export interface NotificationPayload {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface INotificationProvider {
  send(payload: NotificationPayload): Promise<void>;
}

export const NOTIFICATION_PROVIDER = 'NOTIFICATION_PROVIDER';
