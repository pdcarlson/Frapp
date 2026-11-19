import { Module } from '@nestjs/common';
import { MeetingMinutesRequestService } from '../../application/services/meeting-minutes-request.service';
import { MeetingMinutesRequestController } from '../../interface/controllers/meeting-minutes-request.controller';
import { SupabaseMeetingRepository } from '../../infrastructure/supabase/repositories/supabase-meeting.repository';
import { SupabaseMeetingMinutesRequestRepository } from '../../infrastructure/supabase/repositories/supabase-meeting-minutes-request.repository';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { MEETING_REPOSITORY } from '#domain/repositories/meeting.repository.interface';
import { MEETING_MINUTES_REQUEST_REPOSITORY } from '#domain/repositories/meeting-minutes-request.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { EventModule } from '../event/event.module';
import { RbacModule } from '../rbac/rbac.module';
import { NotificationModule } from '../notification/notification.module';

/**
 * Members asking for unposted minutes (#5471). Its own module, so the
 * hand-written minutes (`MeetingModule`) don't grow another concern.
 */
@Module({
  // EventModule → EventService: the event read rule decides who may ask.
  imports: [EventModule, RbacModule, NotificationModule],
  controllers: [MeetingMinutesRequestController],
  providers: [
    MeetingMinutesRequestService,
    { provide: MEETING_REPOSITORY, useClass: SupabaseMeetingRepository },
    {
      provide: MEETING_MINUTES_REQUEST_REPOSITORY,
      useClass: SupabaseMeetingMinutesRequestRepository,
    },
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
  ],
})
export class MeetingMinutesRequestModule {}
