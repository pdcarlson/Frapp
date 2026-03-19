import { Injectable, Logger } from '@nestjs/common';
import Expo, { ExpoPushMessage } from 'expo-server-sdk';
import type {
  INotificationProvider,
  PushPayload,
} from '../../domain/adapters/notification.interface';

@Injectable()
export class ExpoPushProvider implements INotificationProvider {
  private readonly expo = new Expo();
  private readonly logger = new Logger(ExpoPushProvider.name);

  async sendToUser(pushTokens: string[], payload: PushPayload): Promise<void> {
    const validTokens = pushTokens.filter((t) => Expo.isExpoPushToken(t));

    if (validTokens.length === 0) return;

    const messages: ExpoPushMessage[] = validTokens.map((token) => ({
      to: token,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      sound: payload.priority === 'SILENT' ? undefined : 'default',
      priority:
        payload.priority === 'URGENT'
          ? 'high'
          : payload.priority === 'SILENT'
            ? 'normal'
            : 'default',
    }));

    const chunks = this.expo.chunkPushNotifications(messages);

    await Promise.allSettled(
      chunks.map(async (chunk) => {
        try {
          const receipts = await this.expo.sendPushNotificationsAsync(chunk);
          this.logger.debug(`Sent ${receipts.length} push notifications`);
        } catch (error) {
          this.logger.error('Failed to send push notifications', error);
        }
      }),
    );
  }
}
