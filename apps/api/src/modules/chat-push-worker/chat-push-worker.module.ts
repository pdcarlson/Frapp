import { Module } from '@nestjs/common';
import { ChatPushWorkerService } from './chat-push-worker.service';
import { ChatNotificationPreferenceRepository } from './chat-notification-preference.repository';
import { NotificationModule } from '../notification/notification.module';
import { ChapterModule } from '../chapter/chapter.module';

/**
 * Push worker (ADR-09). Runs in-process on the API; the
 * `OnApplicationBootstrap` lifecycle on `ChatPushWorkerService` opens the
 * Supabase Realtime subscription on `chat_messages`. Scaling watermark for a
 * standalone split is documented in `docs/DEPLOYMENT.md`.
 *
 * Imports `NotificationModule` to reuse the preference-aware,
 * quiet-hours-aware Expo fanout; `ChapterModule` to access
 * `MEMBER_REPOSITORY` for chapter membership enumeration.
 */
@Module({
  imports: [NotificationModule, ChapterModule],
  providers: [ChatPushWorkerService, ChatNotificationPreferenceRepository],
})
export class ChatPushWorkerModule {}
