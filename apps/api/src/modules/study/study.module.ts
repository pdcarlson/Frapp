import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { UserModule } from '../user/user.module';
import { PointsModule } from '../points/points.module';
import { NotificationModule } from '../notification/notification.module';
import { STUDY_REPOSITORY } from '../../domain/repositories/study.repository.interface';
import { DrizzleStudyRepository } from '../../infrastructure/database/repositories/drizzle-study.repository';
import { StudyService } from '../../application/services/study.service';
import { GeoService } from '../../application/services/geo.service';
import { StudyController } from '../../interface/controllers/study.controller';

@Module({
  imports: [DatabaseModule, UserModule, PointsModule, NotificationModule],
  controllers: [StudyController],
  providers: [
    StudyService,
    GeoService,
    {
      provide: STUDY_REPOSITORY,
      useClass: DrizzleStudyRepository,
    },
  ],
  exports: [StudyService],
})
export class StudyModule {}
