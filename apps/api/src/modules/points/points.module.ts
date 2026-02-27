import { Module } from '@nestjs/common';
import { PointsService } from '../../application/services/points.service';
import { PointsController } from '../../interface/controllers/points.controller';
import { POINT_TRANSACTION_REPOSITORY } from '../../domain/repositories/point-transaction.repository.interface';
import { SupabasePointTransactionRepository } from '../../infrastructure/supabase/repositories/supabase-point-transaction.repository';
import { SEMESTER_ARCHIVE_REPOSITORY } from '../../domain/repositories/semester-archive.repository.interface';
import { SupabaseSemesterArchiveRepository } from '../../infrastructure/supabase/repositories/supabase-semester-archive.repository';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [PointsController],
  providers: [
    PointsService,
    {
      provide: POINT_TRANSACTION_REPOSITORY,
      useClass: SupabasePointTransactionRepository,
    },
    {
      provide: SEMESTER_ARCHIVE_REPOSITORY,
      useClass: SupabaseSemesterArchiveRepository,
    },
  ],
  exports: [PointsService, POINT_TRANSACTION_REPOSITORY],
})
export class PointsModule {}
