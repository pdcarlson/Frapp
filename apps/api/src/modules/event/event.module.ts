import { Module } from '@nestjs/common';
import { EventController } from '../../interface/controllers/event.controller';
import { EventService } from '../../application/services/event.service';
import { AttendanceService } from '../../application/services/attendance.service';
import { DrizzleEventRepository } from '../../infrastructure/database/repositories/drizzle-event.repository';
import { EVENT_REPOSITORY } from '../../domain/repositories/event.repository.interface';
import { DatabaseModule } from '../database/database.module';
import { PointsModule } from '../points/points.module';
import { UserModule } from '../user/user.module';

import { JwtModule } from '@nestjs/jwt';
import { QrTokenService } from '../../application/services/qr-token.service';

@Module({
  imports: [DatabaseModule, PointsModule, UserModule, JwtModule.register({})],
  controllers: [EventController],
  providers: [
    EventService,
    AttendanceService,
    QrTokenService,
    {
      provide: EVENT_REPOSITORY,
      useClass: DrizzleEventRepository,
    },
  ],
  exports: [EventService, AttendanceService],
})
export class EventModule {}
