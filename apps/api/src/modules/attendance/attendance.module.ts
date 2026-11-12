import { Module } from '@nestjs/common';
import { AttendanceService } from '../../application/services/attendance.service';
import { AttendanceController } from '../../interface/controllers/attendance.controller';
import { SupabaseAttendanceRepository } from '../../infrastructure/supabase/repositories/supabase-attendance.repository';
import { ATTENDANCE_REPOSITORY } from '#domain/repositories/attendance.repository.interface';
import { EVENT_REPOSITORY } from '#domain/repositories/event.repository.interface';
import { SupabaseEventRepository } from '../../infrastructure/supabase/repositories/supabase-event.repository';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { RbacModule } from '../rbac/rbac.module';
import { NotificationModule } from '../notification/notification.module';
import { AuthModule } from '../auth/auth.module';
import { EventExcuseService } from '../../application/services/event-excuse.service';
import { EventExcuseController } from '../../interface/controllers/event-excuse.controller';
import { EVENT_EXCUSE_REPOSITORY } from '#domain/repositories/event-excuse.repository.interface';
import { SupabaseEventExcuseRepository } from '../../infrastructure/supabase/repositories/supabase-event-excuse.repository';

// Imports `RbacModule` so `AttendanceService` can resolve the Alumni lifecycle
// role and deny event check-in (`spec/behavior/alumni.md`). Excuses (#3735)
// live here too, since the sweep reads them: `NotificationModule` pushes them
// and `AuthModule` gives `USER_REPOSITORY` for the names they show.
@Module({
  imports: [RbacModule, NotificationModule, AuthModule],
  controllers: [AttendanceController, EventExcuseController],
  providers: [
    AttendanceService,
    EventExcuseService,
    {
      provide: EVENT_EXCUSE_REPOSITORY,
      useClass: SupabaseEventExcuseRepository,
    },
    { provide: ATTENDANCE_REPOSITORY, useClass: SupabaseAttendanceRepository },
    { provide: EVENT_REPOSITORY, useClass: SupabaseEventRepository },
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
  ],
  exports: [AttendanceService, EventExcuseService],
})
export class AttendanceModule {}
