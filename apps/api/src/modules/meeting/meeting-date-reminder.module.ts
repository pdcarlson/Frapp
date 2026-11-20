import { Module } from '@nestjs/common';
import { MeetingDateReminderService } from '../../application/services/meeting-date-reminder.service';
import { MeetingDateReminderSweepService } from '../../application/workers/meeting-date-reminder-sweep.service';
import { MeetingDateReminderController } from '../../interface/controllers/meeting-date-reminder.controller';
import { SupabaseMeetingDateReminderRepository } from '../../infrastructure/supabase/repositories/supabase-meeting-date-reminder.repository';
import { MEETING_DATE_REMINDER_REPOSITORY } from '#domain/repositories/meeting-date-reminder.repository.interface';
import { RbacModule } from '../rbac/rbac.module';
import { NotificationModule } from '../notification/notification.module';
import { MeetingModule } from './meeting.module';

/**
 * "Remind me" on a minutes' Coming up date (#5672 step 2). Its own module,
 * so the hand-written minutes (`MeetingModule`) don't grow another concern.
 */
@Module({
  // MeetingModule → MeetingService: the minutes' read rule decides who may
  // set a reminder, and whether its push still goes out.
  imports: [MeetingModule, RbacModule, NotificationModule],
  controllers: [MeetingDateReminderController],
  providers: [
    MeetingDateReminderService,
    MeetingDateReminderSweepService,
    {
      provide: MEETING_DATE_REMINDER_REPOSITORY,
      useClass: SupabaseMeetingDateReminderRepository,
    },
  ],
})
export class MeetingDateReminderModule {}
