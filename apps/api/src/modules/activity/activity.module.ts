import { Module } from '@nestjs/common';
import { ActivityService } from '../../application/services/activity.service';
import { ActivityController } from '../../interface/controllers/activity.controller';
import { SupabaseChatMessageRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message.repository';
import { SupabaseChatMessageActionRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message-action.repository';
import { SupabaseAttendanceRepository } from '../../infrastructure/supabase/repositories/supabase-attendance.repository';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { ATTENDANCE_REPOSITORY } from '#domain/repositories/attendance.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import {
  CHAT_MESSAGE_ACTION_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
} from '#domain/repositories/chat.repository.interface';
import { AuthModule } from '../auth/auth.module';
import { BackworkModule } from '../backwork/backwork.module';
import { ChapterDocumentModule } from '../chapter-document/chapter-document.module';
import { ChatBlockModule } from '../chat-block/chat-block.module';
import { ChatModule } from '../chat/chat.module';
import { EventModule } from '../event/event.module';
import { RbacModule } from '../rbac/rbac.module';
import { ServiceEntryModule } from '../service-entry/service-entry.module';
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
    ChapterDocumentModule,
    BackworkModule,
    ChatModule,
    ChatBlockModule,
    RbacModule,
    AuthModule,
  ],
  controllers: [ActivityController],
  providers: [
    ActivityService,
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
    // The member's role ids (their own answer to each event) and their
    // attendance rows, read directly: the event list has already settled
    // which events they may see.
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
    { provide: ATTENDANCE_REPOSITORY, useClass: SupabaseAttendanceRepository },
  ],
})
export class ActivityModule {}
