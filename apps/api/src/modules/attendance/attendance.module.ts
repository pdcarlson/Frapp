import { Module } from '@nestjs/common';
import { AttendanceService } from '../../application/services/attendance.service';
import { AttendanceController } from '../../interface/controllers/attendance.controller';
import { SupabaseAttendanceRepository } from '../../infrastructure/supabase/repositories/supabase-attendance.repository';
import { ATTENDANCE_REPOSITORY } from '../../domain/repositories/attendance.repository.interface';
import { EVENT_REPOSITORY } from '../../domain/repositories/event.repository.interface';
import { SupabaseEventRepository } from '../../infrastructure/supabase/repositories/supabase-event.repository';
import { POINT_TRANSACTION_REPOSITORY } from '../../domain/repositories/point-transaction.repository.interface';
import { SupabasePointTransactionRepository } from '../../infrastructure/supabase/repositories/supabase-point-transaction.repository';

@Module({
  controllers: [AttendanceController],
  providers: [
    AttendanceService,
    { provide: ATTENDANCE_REPOSITORY, useClass: SupabaseAttendanceRepository },
    { provide: EVENT_REPOSITORY, useClass: SupabaseEventRepository },
    {
      provide: POINT_TRANSACTION_REPOSITORY,
      useClass: SupabasePointTransactionRepository,
    },
  ],
  exports: [AttendanceService, ATTENDANCE_REPOSITORY],
})
export class AttendanceModule {}
