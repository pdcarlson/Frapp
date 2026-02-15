import { Injectable, Logger } from '@nestjs/common';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import {
  INotificationProvider,
  NotificationPayload,
} from '../../domain/adapters/notification.interface';

@Injectable()
export class ExpoNotificationProvider implements INotificationProvider {
  private readonly expo: Expo;
  private readonly logger = new Logger(ExpoNotificationProvider.name);

  constructor() {
    this.expo = new Expo();
  }

  async send(payload: NotificationPayload): Promise<void> {
    const messages: ExpoPushMessage[] = [];

    for (const pushToken of payload.tokens) {
      if (!Expo.isExpoPushToken(pushToken)) {
        this.logger.error(
          `Push token ${String(pushToken)} is not a valid Expo push token`,
        );
        continue;
      }

      messages.push({
        to: pushToken,
        sound: 'default',
        title: payload.title,
        body: payload.body,
        data: payload.data,
      });
    }

    const chunks = this.expo.chunkPushNotifications(messages);
    const tickets = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        this.logger.error('Error sending notification chunk', error);
      }
    }

    // Note: In a production system, we'd also handle the tickets to remove invalid tokens
    this.logger.log(
      `Sent ${messages.length} notifications in ${chunks.length} chunks`,
    );
  }
}
