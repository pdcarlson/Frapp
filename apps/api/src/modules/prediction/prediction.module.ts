import { Module } from '@nestjs/common';
import { PredictionService } from '../../application/services/prediction.service';
import { PredictionPayoutSweepService } from '../../application/workers/prediction-payout-sweep.service';
import { PredictionController } from '../../interface/controllers/prediction.controller';
import { PREDICTION_REPOSITORY } from '#domain/repositories/prediction.repository.interface';
import { SupabasePredictionRepository } from '../../infrastructure/supabase/repositories/supabase-prediction.repository';
import { ChannelAccessModule } from '../channel-access/channel-access.module';
import { ChapterConfigModule } from '../chapter-config/chapter-config.module';
import { ChapterModule } from '../chapter/chapter.module';
import { PointsModule } from '../points/points.module';
import { RbacModule } from '../rbac/rbac.module';

/**
 * Predictions (#5133). ChannelAccessModule → who can see and stake in a
 * market's channel; ChapterConfigModule → the per-market stake cap;
 * ChapterModule → MEMBER_REPOSITORY (a settler or named member must belong);
 * PointsModule → the semester window a stake spends from; RbacModule → the
 * caller's permissions and whether they are alumni.
 */
@Module({
  imports: [
    ChannelAccessModule,
    ChapterConfigModule,
    ChapterModule,
    PointsModule,
    RbacModule,
  ],
  controllers: [PredictionController],
  providers: [
    PredictionService,
    PredictionPayoutSweepService,
    {
      provide: PREDICTION_REPOSITORY,
      useClass: SupabasePredictionRepository,
    },
  ],
})
export class PredictionModule {}
