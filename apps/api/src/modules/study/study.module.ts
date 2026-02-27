import { Module } from '@nestjs/common';
import { StudyService } from '../../application/services/study.service';
import { StudyGeofenceController } from '../../interface/controllers/study.controller';
import { StudySessionController } from '../../interface/controllers/study.controller';
import { SupabaseStudyGeofenceRepository } from '../../infrastructure/supabase/repositories/supabase-study-geofence.repository';
import { SupabaseStudySessionRepository } from '../../infrastructure/supabase/repositories/supabase-study-session.repository';
import { SupabasePointTransactionRepository } from '../../infrastructure/supabase/repositories/supabase-point-transaction.repository';
import { STUDY_GEOFENCE_REPOSITORY } from '../../domain/repositories/study.repository.interface';
import { STUDY_SESSION_REPOSITORY } from '../../domain/repositories/study.repository.interface';
import { POINT_TRANSACTION_REPOSITORY } from '../../domain/repositories/point-transaction.repository.interface';

@Module({
  controllers: [StudyGeofenceController, StudySessionController],
  providers: [
    StudyService,
    {
      provide: STUDY_GEOFENCE_REPOSITORY,
      useClass: SupabaseStudyGeofenceRepository,
    },
    {
      provide: STUDY_SESSION_REPOSITORY,
      useClass: SupabaseStudySessionRepository,
    },
    {
      provide: POINT_TRANSACTION_REPOSITORY,
      useClass: SupabasePointTransactionRepository,
    },
  ],
  exports: [StudyService],
})
export class StudyModule {}
