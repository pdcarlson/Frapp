import { Module } from '@nestjs/common';
import { ChapterDocumentService } from '../../application/services/chapter-document.service';
import { ChapterDocumentController } from '../../interface/controllers/chapter-document.controller';
import { SupabaseChapterDocumentRepository } from '../../infrastructure/supabase/repositories/supabase-chapter-document.repository';
import { SupabaseChapterDocumentFolderRepository } from '../../infrastructure/supabase/repositories/supabase-chapter-document-folder.repository';
import { CHAPTER_DOCUMENT_REPOSITORY } from '#domain/repositories/chapter-document.repository.interface';
import { CHAPTER_DOCUMENT_FOLDER_REPOSITORY } from '#domain/repositories/chapter-document-folder.repository.interface';
import { SupabaseChapterDocumentStarRepository } from '../../infrastructure/supabase/repositories/supabase-chapter-document-star.repository';
import { CHAPTER_DOCUMENT_STAR_REPOSITORY } from '#domain/repositories/chapter-document-star.repository.interface';
import { ChapterDocumentTypeService } from '../../application/services/chapter-document-type.service';
import { SupabaseChapterDocumentTypeRepository } from '../../infrastructure/supabase/repositories/supabase-chapter-document-type.repository';
import { CHAPTER_DOCUMENT_TYPE_REPOSITORY } from '#domain/repositories/chapter-document-type.repository.interface';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';

@Module({
  controllers: [ChapterDocumentController],
  providers: [
    ChapterDocumentService,
    ChapterDocumentTypeService,
    {
      provide: CHAPTER_DOCUMENT_REPOSITORY,
      useClass: SupabaseChapterDocumentRepository,
    },
    {
      provide: CHAPTER_DOCUMENT_FOLDER_REPOSITORY,
      useClass: SupabaseChapterDocumentFolderRepository,
    },
    {
      provide: CHAPTER_DOCUMENT_STAR_REPOSITORY,
      useClass: SupabaseChapterDocumentStarRepository,
    },
    {
      provide: CHAPTER_DOCUMENT_TYPE_REPOSITORY,
      useClass: SupabaseChapterDocumentTypeRepository,
    },
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
  ],
  // `BootstrapModule` reads the document list from it (#4709).
  exports: [ChapterDocumentService],
})
export class ChapterDocumentModule {}
