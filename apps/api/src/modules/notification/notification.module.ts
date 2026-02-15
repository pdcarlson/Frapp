import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { UserModule } from '../user/user.module';
import { NOTIFICATION_REPOSITORY } from '../../domain/repositories/notification.repository.interface';
import { DrizzleNotificationRepository } from '../../infrastructure/database/repositories/drizzle-notification.repository';
import { NOTIFICATION_PROVIDER } from '../../domain/adapters/notification.interface';
import { ExpoNotificationProvider } from '../../infrastructure/notifications/expo-notification.provider';
import { NotificationService } from '../../application/services/notification.service';
import { NotificationController } from '../../interface/controllers/notification.controller';

@Module({
  imports: [DatabaseModule, UserModule],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    {
      provide: NOTIFICATION_REPOSITORY,
      useClass: DrizzleNotificationRepository,
    },
    {
      provide: NOTIFICATION_PROVIDER,
      useClass: ExpoNotificationProvider,
    },
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
