import { Module } from '@nestjs/common';
import { ActivityService } from '../../application/services/activity.service';
import { ActivityLinkService } from '../../application/services/activity-link.service';
import { ActivityStandingService } from '../../application/services/activity-standing.service';
import { SupabaseChatMessageLinkRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message-link.repository';
import { CHAT_MESSAGE_LINK_REPOSITORY } from '#domain/repositories/chat-message-link.repository.interface';
import { SupabaseActivityItemReadRepository } from '../../infrastructure/supabase/repositories/supabase-activity-item-read.repository';
import { ACTIVITY_ITEM_READ_REPOSITORY } from '#domain/repositories/activity-item-read.repository.interface';
import { ActivityController } from '../../interface/controllers/activity.controller';
import { ChatReminderController } from '../../interface/controllers/chat-reminder.controller';
import { ChatReminderService } from '../../application/services/chat-reminder.service';
import { ChatReminderSweepService } from '../../application/workers/chat-reminder-sweep.service';
import { SupabaseChatMessageReminderRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message-reminder.repository';
import { CHAT_MESSAGE_REMINDER_REPOSITORY } from '#domain/repositories/chat-message-reminder.repository.interface';
import { NotificationModule } from '../notification/notification.module';
import { LinkTitleSweepService } from '../../application/workers/link-title-sweep.service';
import { HttpsLinkTitleFetcher } from '../../infrastructure/link-title/https-link-title.fetcher';
import { LINK_TITLE_FETCHER } from '#domain/adapters/link-title.interface';
import { SupabaseChatMessageRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message.repository';
import { SupabaseChatMessageActionRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message-action.repository';
import { SupabaseChatFormResponseRepository } from '../../infrastructure/supabase/repositories/supabase-chat-form-response.repository';
import { CHAT_FORM_RESPONSE_REPOSITORY } from '#domain/repositories/chat-form-response.repository.interface';
import { SupabaseAttendanceRepository } from '../../infrastructure/supabase/repositories/supabase-attendance.repository';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { ATTENDANCE_REPOSITORY } from '#domain/repositories/attendance.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import {
  CHAT_MESSAGE_ACTION_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
} from '#domain/repositories/chat.repository.interface';
import { AuthModule } from '../auth/auth.module';
import { ChatBlockModule } from '../chat-block/chat-block.module';
import { ChannelAccessModule } from '../channel-access/channel-access.module';
import { ChatModule } from '../chat/chat.module';
import { EventModule } from '../event/event.module';
import { GoalsModule } from '../goals/goals.module';
import { PointsModule } from '../points/points.module';
import { RbacModule } from '../rbac/rbac.module';
import { ServiceEntryModule } from '../service-entry/service-entry.module';
import { StudyModule } from '../study/study.module';
import { TaskModule } from '../task/task.module';

@Module({
  // One import per module this page reads through, so every section stays
  // behind the service that owns its rule (repositories are provided below). `ChatModule` → `ChatService`, whose
  // channel list is the access rule for polls; `ChatBlockModule` → the one
  // `ChatBlockService` instance every chat read masks with; `AuthModule` →
  // `USER_REPOSITORY`, for the names on task and hours rows.
  imports: [
    TaskModule,
    ServiceEntryModule,
    EventModule,
    ChatModule,
    ChatBlockModule,
    // `ChannelAccessService`, for the read check behind a member's Done or Hide.
    ChannelAccessModule,
    RbacModule,
    AuthModule,
    // The standing (`GET /v1/activity/standing`): the semester's points and
    // board, and the member's own study sessions.
    PointsModule,
    StudyModule,
    // Each member's goal on points, service and study (#1062).
    GoalsModule,
    NotificationModule,
  ],
  controllers: [ActivityController, ChatReminderController],
  providers: [
    ActivityService,
    ActivityLinkService,
    ActivityStandingService,
    // Links on Activity (#3897): this module is the table's only reader. The
    // database's triggers on `chat_messages` write its rows; the title sweep
    // below writes only their page titles.
    {
      provide: CHAT_MESSAGE_LINK_REPOSITORY,
      useClass: SupabaseChatMessageLinkRepository,
    },
    // Link titles (#4187): the background sweep that reads each link's page
    // title, through the one guarded fetcher in the API that opens a
    // URL a member posted. Built by a factory, since a spec passes its own
    // DNS and request in place of the network.
    LinkTitleSweepService,
    // "Remind me about this" (#4957): its routes, its Activity section and
    // the minute sweep that sends its pushes.
    ChatReminderService,
    ChatReminderSweepService,
    {
      provide: CHAT_MESSAGE_REMINDER_REPOSITORY,
      useClass: SupabaseChatMessageReminderRepository,
    },
    {
      provide: LINK_TITLE_FETCHER,
      useFactory: () => new HttpsLinkTitleFetcher(),
    },
    // Which items each member opened, for unread dots (#4173). This module
    // is the table's only reader and writer.
    {
      provide: ACTIVITY_ITEM_READ_REPOSITORY,
      useClass: SupabaseActivityItemReadRepository,
    },
    // The two chat repositories are provided here, as `ChannelAccessModule`
    // does, rather than exported from `ChatModule`: they are stateless query
    // classes, and `ChatModule` exports services only.
    {
      provide: CHAT_MESSAGE_REPOSITORY,
      useClass: SupabaseChatMessageRepository,
    },
    {
      provide: CHAT_MESSAGE_ACTION_REPOSITORY,
      useClass: SupabaseChatMessageActionRepository,
    },
    // Which form cards the member has answered (#3926 step 4), read by id
    // and never their answers.
    {
      provide: CHAT_FORM_RESPONSE_REPOSITORY,
      useClass: SupabaseChatFormResponseRepository,
    },
    // The member's role ids (their own answer to each event) and their
    // attendance rows, read directly: the event list has already settled
    // which events they may see.
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
    { provide: ATTENDANCE_REPOSITORY, useClass: SupabaseAttendanceRepository },
  ],
  // For Frapp AI's standing tools (#4901), which read the standing as `GET
  // /v1/activity/standing` does.
  exports: [ActivityStandingService],
})
export class ActivityModule {}
