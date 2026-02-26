import { Module } from '@nestjs/common';
import { PointsService } from '../../application/services/points.service';
import { PointsController } from '../../interface/controllers/points.controller';
import { POINT_TRANSACTION_REPOSITORY } from '../../domain/repositories/point-transaction.repository.interface';
import { SupabasePointTransactionRepository } from '../../infrastructure/supabase/repositories/supabase-point-transaction.repository';

@Module({
  controllers: [PointsController],
  providers: [
    PointsService,
    {
      provide: POINT_TRANSACTION_REPOSITORY,
      useClass: SupabasePointTransactionRepository,
    },
  ],
  exports: [PointsService, POINT_TRANSACTION_REPOSITORY],
})
export class PointsModule {}
