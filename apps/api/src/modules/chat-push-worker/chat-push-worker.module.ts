import { Module } from '@nestjs/common';
import { ChatPushWorkerService } from './chat-push-worker.service';
import { ChatNotificationPreferenceRepository } from './chat-notification-preference.repository';
import { NotificationModule } from '../notification/notification.module';
import { ChapterModule } from '../chapter/chapter.module';
import { RbacModule } from '../rbac/rbac.module';
import { ChannelCacheModule } from './channel-cache.module';

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
  // `RbacModule` → `RbacService`, used to resolve effective permissions when
  // deciding whether a ROLE_GATED channel's message may be pushed to a member.
  // `ChannelCacheModule` → `ChannelCacheService`, shared with `ChatModule` so a
  // channel write can evict this worker's cached authorization inputs.
  imports: [NotificationModule, ChapterModule, RbacModule, ChannelCacheModule],
  providers: [ChatPushWorkerService, ChatNotificationPreferenceRepository],
})
export class ChatPushWorkerModule {}
