export const NOTIFICATION_PROVIDER = 'NOTIFICATION_PROVIDER';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
  priority?: 'URGENT' | 'NORMAL' | 'SILENT';
}

export interface INotificationProvider {
  sendToUser(pushTokens: string[], payload: PushPayload): Promise<void>;
}
