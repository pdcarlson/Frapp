import { Module } from '@nestjs/common';
import { PointsController } from '../../interface/controllers/points.controller';
import { PointsService } from '../../application/services/points.service';
import { DrizzlePointRepository } from '../../infrastructure/database/repositories/drizzle-point.repository';
import { POINT_REPOSITORY } from '../../domain/repositories/point.repository.interface';
import { DatabaseModule } from '../database/database.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [DatabaseModule, UserModule],
  controllers: [PointsController],
  providers: [
    PointsService,
    {
      provide: POINT_REPOSITORY,
      useClass: DrizzlePointRepository,
    },
  ],
  exports: [PointsService],
})
export class PointsModule {}
