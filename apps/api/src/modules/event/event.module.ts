import { Module } from '@nestjs/common';
import { EventService } from '../../application/services/event.service';
import { EventSeriesService } from '../../application/services/event-series.service';
import { EventAnnouncementService } from '../../application/services/event-announcement.service';
import { EventController } from '../../interface/controllers/event.controller';
import { EventTypeService } from '../../application/services/event-type.service';
import { EventTypeController } from '../../interface/controllers/event-type.controller';
import { SupabaseEventTypeRepository } from '../../infrastructure/supabase/repositories/supabase-event-type.repository';
import { EVENT_TYPE_REPOSITORY } from '#domain/repositories/event-type.repository.interface';
import { SupabaseEventRepository } from '../../infrastructure/supabase/repositories/supabase-event.repository';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { EVENT_REPOSITORY } from '#domain/repositories/event.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { NotificationModule } from '../notification/notification.module';
import { ChatModule } from '../chat/chat.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [NotificationModule, ChatModule, AuthModule, RbacModule],
  controllers: [EventController, EventTypeController],
  providers: [
    EventService,
    EventSeriesService,
    EventAnnouncementService,
    EventTypeService,
    { provide: EVENT_TYPE_REPOSITORY, useClass: SupabaseEventTypeRepository },
    { provide: EVENT_REPOSITORY, useClass: SupabaseEventRepository },
    // Bound locally rather than importing ChapterModule (its exporter) — same
    // choice AttendanceModule makes for the same repository, to avoid pulling
    // in ChapterModule's own import graph just for one lightweight token.
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
  ],
  exports: [EventService],
})
export class EventModule {}
