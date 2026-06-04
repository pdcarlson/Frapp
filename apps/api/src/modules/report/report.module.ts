import { Module } from '@nestjs/common';
import { ReportService } from '../../application/services/report.service';
import { ReportController } from '../../interface/controllers/report.controller';
import { SEMESTER_ARCHIVE_REPOSITORY } from '../../domain/repositories/semester-archive.repository.interface';
import { SupabaseSemesterArchiveRepository } from '../../infrastructure/supabase/repositories/supabase-semester-archive.repository';

@Module({
  controllers: [ReportController],
  providers: [
    ReportService,
    // Points report resolves the semester window from the latest archive,
    // matching the leaderboard's source (see report.service.getPointsReport).
    {
      provide: SEMESTER_ARCHIVE_REPOSITORY,
      useClass: SupabaseSemesterArchiveRepository,
    },
  ],
  exports: [ReportService],
})
export class ReportModule {}
