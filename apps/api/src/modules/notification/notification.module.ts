import { Module } from '@nestjs/common';
import { NotificationService } from '../../application/services/notification.service';
import { NotificationController } from '../../interface/controllers/notification.controller';
import { AuthSyncInterceptor } from '../../interface/interceptors/auth-sync.interceptor';
import { SupabaseNotificationRepository } from '../../infrastructure/supabase/repositories/supabase-notification.repository';
import { SupabasePushTokenRepository } from '../../infrastructure/supabase/repositories/supabase-push-token.repository';
import { SupabaseNotificationPreferenceRepository } from '../../infrastructure/supabase/repositories/supabase-notification-preference.repository';
import { SupabaseUserSettingsRepository } from '../../infrastructure/supabase/repositories/supabase-user-settings.repository';
import {
  NOTIFICATION_REPOSITORY,
  PUSH_TOKEN_REPOSITORY,
  NOTIFICATION_PREFERENCE_REPOSITORY,
  USER_SETTINGS_REPOSITORY,
} from '../../domain/repositories/notification.repository.interface';
import { NOTIFICATION_PROVIDER } from '../../domain/adapters/notification.interface';
import { ExpoPushProvider } from '../../infrastructure/notifications/expo-push.provider';
import { AuthModule } from '../auth/auth.module';
import { ChapterModule } from '../chapter/chapter.module';

@Module({
  imports: [AuthModule, ChapterModule],
  controllers: [NotificationController],
  providers: [
    AuthSyncInterceptor,
    NotificationService,
    { provide: NOTIFICATION_REPOSITORY, useClass: SupabaseNotificationRepository },
    { provide: PUSH_TOKEN_REPOSITORY, useClass: SupabasePushTokenRepository },
    {
      provide: NOTIFICATION_PREFERENCE_REPOSITORY,
      useClass: SupabaseNotificationPreferenceRepository,
    },
    {
      provide: USER_SETTINGS_REPOSITORY,
      useClass: SupabaseUserSettingsRepository,
    },
    { provide: NOTIFICATION_PROVIDER, useClass: ExpoPushProvider },
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
