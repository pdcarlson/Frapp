import { Module } from '@nestjs/common';
import { ChapterDocumentService } from '../../application/services/chapter-document.service';
import { ChapterDocumentController } from '../../interface/controllers/chapter-document.controller';
import { SupabaseChapterDocumentRepository } from '../../infrastructure/supabase/repositories/supabase-chapter-document.repository';
import { CHAPTER_DOCUMENT_REPOSITORY } from '../../domain/repositories/chapter-document.repository.interface';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';

@Module({
  controllers: [ChapterDocumentController],
  providers: [
    ChapterDocumentService,
    {
      provide: CHAPTER_DOCUMENT_REPOSITORY,
      useClass: SupabaseChapterDocumentRepository,
    },
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
  ],
  exports: [ChapterDocumentService],
})
export class ChapterDocumentModule {}
