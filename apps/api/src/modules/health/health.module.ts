import { Module } from '@nestjs/common';
import { HealthController } from '../../interface/controllers/health.controller';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
