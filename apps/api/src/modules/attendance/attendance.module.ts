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
import { EVENT_CHECK_IN_SCREEN_REPOSITORY } from '#domain/repositories/event-check-in-screen.repository.interface';
import { SupabaseEventCheckInScreenRepository } from '../../infrastructure/supabase/repositories/supabase-event-check-in-screen.repository';
import { CheckInScreenSweepService } from '../../application/workers/check-in-screen-sweep.service';

// Imports `RbacModule` so `AttendanceService` can resolve the Alumni lifecycle
// role and deny event check-in (`spec/behavior/alumni.md`).
@Module({
  imports: [RbacModule],
  controllers: [AttendanceController],
  providers: [
    AttendanceService,
    { provide: ATTENDANCE_REPOSITORY, useClass: SupabaseAttendanceRepository },
    { provide: EVENT_REPOSITORY, useClass: SupabaseEventRepository },
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
    {
      provide: EVENT_CHECK_IN_SCREEN_REPOSITORY,
      useClass: SupabaseEventCheckInScreenRepository,
    },
    CheckInScreenSweepService,
  ],
  exports: [AttendanceService],
})
export class AttendanceModule {}
