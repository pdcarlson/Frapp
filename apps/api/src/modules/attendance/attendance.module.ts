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
  ],
  exports: [AttendanceService],
})
export class AttendanceModule {}
