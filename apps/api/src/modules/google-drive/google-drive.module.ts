import { Module } from '@nestjs/common';
import { GoogleDriveService } from '../../application/services/google-drive/google-drive.service';
import { GoogleDriveSyncService } from '../../application/services/google-drive/google-drive-sync.service';
import { GoogleDriveSyncSweepService } from '../../application/workers/google-drive-sync-sweep.service';
import { GoogleDriveController } from '../../interface/controllers/google-drive.controller';
import { SupabaseChapterDriveRepository } from '../../infrastructure/supabase/repositories/supabase-chapter-drive.repository';
import { SupabaseChapterDocumentRepository } from '../../infrastructure/supabase/repositories/supabase-chapter-document.repository';
import { GoogleDriveApiClient } from '../../infrastructure/google/google-drive-api.client';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';
import { CHAPTER_DRIVE_REPOSITORY } from '#domain/repositories/chapter-drive.repository.interface';
import { CHAPTER_DOCUMENT_REPOSITORY } from '#domain/repositories/chapter-document.repository.interface';
import { GOOGLE_DRIVE_API } from '#domain/adapters/google-drive.interface';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import { AuthModule } from '../auth/auth.module';
import { ChapterDocumentModule } from '../chapter-document/chapter-document.module';
import { ChapterModule } from '../chapter/chapter.module';
import { RbacModule } from '../rbac/rbac.module';

/** A chapter's Google Drive folder, copied into Documents (#5157). */
@Module({
  // ChapterDocumentModule → ChapterDocumentService (folders); ChapterModule
  // and RbacModule → the guards.
  imports: [AuthModule, ChapterDocumentModule, ChapterModule, RbacModule],
  controllers: [GoogleDriveController],
  providers: [
    GoogleDriveService,
    GoogleDriveSyncService,
    GoogleDriveSyncSweepService,
    {
      provide: CHAPTER_DRIVE_REPOSITORY,
      useClass: SupabaseChapterDriveRepository,
    },
    {
      provide: CHAPTER_DOCUMENT_REPOSITORY,
      useClass: SupabaseChapterDocumentRepository,
    },
    // The key is read once, from the environment (`config/google-drive-config.ts`).
    { provide: GOOGLE_DRIVE_API, useFactory: () => new GoogleDriveApiClient() },
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
  ],
})
export class GoogleDriveModule {}
