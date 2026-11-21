import { Module } from '@nestjs/common';
import { MeetingNoMinutesService } from '../../application/services/meeting-no-minutes.service';
import { MeetingNoMinutesController } from '../../interface/controllers/meeting-no-minutes.controller';
import { SupabaseMeetingNoMinutesRepository } from '../../infrastructure/supabase/repositories/supabase-meeting-no-minutes.repository';
import { MEETING_NO_MINUTES_REPOSITORY } from '#domain/repositories/meeting-no-minutes.repository.interface';
import { EventModule } from '../event/event.module';
import { RbacModule } from '../rbac/rbac.module';
import { MeetingModule } from './meeting.module';

/**
 * Meetings marked "No minutes" (Paul, 2026-11-20). Its own module, so the
 * hand-written minutes (`MeetingModule`) don't grow another concern.
 */
@Module({
  imports: [MeetingModule, EventModule, RbacModule],
  controllers: [MeetingNoMinutesController],
  providers: [
    MeetingNoMinutesService,
    {
      provide: MEETING_NO_MINUTES_REPOSITORY,
      useClass: SupabaseMeetingNoMinutesRepository,
    },
  ],
})
export class MeetingNoMinutesModule {}
