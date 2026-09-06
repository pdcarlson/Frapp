import { Module } from '@nestjs/common';
import { ReportRetentionService } from '../../application/services/report-retention.service';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';

/**
 * Reaping of generated report PDFs, in its own module because it has two
 * unrelated callers: the hourly retention sweep (`ScheduledJobsModule`) and
 * the account-deletion erasure path (`UserModule`).
 *
 * Deliberately not folded into `ReportModule` — that module exists to serve
 * the reports API and drags in the controller, the PDF renderer, and the
 * semester-archive repository, none of which a purge needs. Importing it into
 * the deletion flow to reach one service would couple account deletion to the
 * whole reporting surface.
 */
@Module({
  providers: [
    ReportRetentionService,
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
  ],
  exports: [ReportRetentionService],
})
export class ReportRetentionModule {}
