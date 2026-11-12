import { Module } from '@nestjs/common';
import { MeetingService } from '../../application/services/meeting.service';
import { MeetingController } from '../../interface/controllers/meeting.controller';
import { SupabaseMeetingRepository } from '../../infrastructure/supabase/repositories/supabase-meeting.repository';
import { SupabaseAttendanceRepository } from '../../infrastructure/supabase/repositories/supabase-attendance.repository';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { MEETING_REPOSITORY } from '#domain/repositories/meeting.repository.interface';
import { ATTENDANCE_REPOSITORY } from '#domain/repositories/attendance.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { EventModule } from '../event/event.module';
import { RbacModule } from '../rbac/rbac.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  // EventModule → EventService: the event read rule decides who reads the
  // minutes, and a meeting with no event gets one through it.
  imports: [EventModule, RbacModule, NotificationModule],
  controllers: [MeetingController],
  providers: [
    MeetingService,
    { provide: MEETING_REPOSITORY, useClass: SupabaseMeetingRepository },
    { provide: ATTENDANCE_REPOSITORY, useClass: SupabaseAttendanceRepository },
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
  ],
})
export class MeetingModule {}
