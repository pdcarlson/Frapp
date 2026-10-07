import { Module } from '@nestjs/common';
import { ReportService } from '../../application/services/report.service';
import { ReportExportService } from '../../application/services/report-export.service';
import { ReportController } from '../../interface/controllers/report.controller';
import { REPORT_REPOSITORY } from '#domain/repositories/report.repository.interface';
import { SupabaseReportRepository } from '../../infrastructure/supabase/repositories/supabase-report.repository';
import { SEMESTER_ARCHIVE_REPOSITORY } from '#domain/repositories/semester-archive.repository.interface';
import { SupabaseSemesterArchiveRepository } from '../../infrastructure/supabase/repositories/supabase-semester-archive.repository';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import { SupabaseUserRepository } from '../../infrastructure/supabase/repositories/supabase-user.repository';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import { SupabaseChapterRepository } from '../../infrastructure/supabase/repositories/supabase-chapter.repository';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';
import { REPORT_PDF_RENDERER } from '#domain/adapters/pdf.interface';
import { ReportPdfRenderer } from '../../infrastructure/pdf/report-pdf.renderer';

@Module({
  controllers: [ReportController],
  providers: [
    ReportService,
    ReportExportService,
    { provide: REPORT_REPOSITORY, useClass: SupabaseReportRepository },
    // The service report's member names, through the batched display read.
    { provide: USER_REPOSITORY, useClass: SupabaseUserRepository },
    // Points report resolves the semester window from the latest archive,
    // matching the leaderboard's source (see report.service.getPointsReport).
    {
      provide: SEMESTER_ARCHIVE_REPOSITORY,
      useClass: SupabaseSemesterArchiveRepository,
    },
    // PDF export reads chapter name/university/logo for the branded header and
    // writes the rendered document to the private `reports` bucket.
    { provide: CHAPTER_REPOSITORY, useClass: SupabaseChapterRepository },
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
    { provide: REPORT_PDF_RENDERER, useClass: ReportPdfRenderer },
  ],
})
export class ReportModule {}
