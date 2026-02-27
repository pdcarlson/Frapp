import { Module } from '@nestjs/common';
import { SemesterRolloverService } from '../../application/services/semester-rollover.service';
import { SemesterRolloverController } from '../../interface/controllers/semester-rollover.controller';
import { SupabaseSemesterArchiveRepository } from '../../infrastructure/supabase/repositories/supabase-semester-archive.repository';
import { SEMESTER_ARCHIVE_REPOSITORY } from '../../domain/repositories/semester-archive.repository.interface';

@Module({
  controllers: [SemesterRolloverController],
  providers: [
    SemesterRolloverService,
    {
      provide: SEMESTER_ARCHIVE_REPOSITORY,
      useClass: SupabaseSemesterArchiveRepository,
    },
  ],
  exports: [SemesterRolloverService],
})
export class SemesterRolloverModule {}
