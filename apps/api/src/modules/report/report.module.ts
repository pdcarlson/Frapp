import { Module } from '@nestjs/common';
import { ReportService } from '../../application/services/report.service';
import { ReportExportService } from '../../application/services/report-export.service';
import { ReportController } from '../../interface/controllers/report.controller';
import { SEMESTER_ARCHIVE_REPOSITORY } from '../../domain/repositories/semester-archive.repository.interface';
import { SupabaseSemesterArchiveRepository } from '../../infrastructure/supabase/repositories/supabase-semester-archive.repository';
import { CHAPTER_REPOSITORY } from '../../domain/repositories/chapter.repository.interface';
import { SupabaseChapterRepository } from '../../infrastructure/supabase/repositories/supabase-chapter.repository';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';
import { REPORT_PDF_RENDERER } from '../../domain/adapters/pdf.interface';
import { ReportPdfRenderer } from '../../infrastructure/pdf/report-pdf.renderer';

@Module({
  controllers: [ReportController],
  providers: [
    ReportService,
    ReportExportService,
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
  exports: [ReportService],
})
export class ReportModule {}
