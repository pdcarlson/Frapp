import { Module } from '@nestjs/common';
import { ReportService } from '../../application/services/report.service';
import { ReportController } from '../../interface/controllers/report.controller';

@Module({
  controllers: [ReportController],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportModule {}
