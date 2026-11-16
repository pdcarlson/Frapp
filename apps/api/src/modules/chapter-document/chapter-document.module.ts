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
import { ChannelAccessListService } from '../../application/services/channel-access-list.service';
import { SupabaseChatCategoryRepository } from '../../infrastructure/supabase/repositories/supabase-chat-category.repository';
import { CHAT_CATEGORY_REPOSITORY } from '#domain/repositories/chat.repository.interface';
import { ChapterModule } from '../chapter/chapter.module';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  // Who can see (#3642 piece 1) checks lists as a chat channel's are:
  // ChapterModule → the role, tier, group and member repositories that
  // ChannelAccessListService reads; RbacModule → RbacService for the viewer's
  // entries and rank. The category repository is only for that service's
  // channel-category check, which Documents never calls.
  imports: [ChapterModule, RbacModule],
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
    ChannelAccessListService,
    {
      provide: CHAT_CATEGORY_REPOSITORY,
      useClass: SupabaseChatCategoryRepository,
    },
  ],
  // `BootstrapModule` reads the document list from it (#4709).
  exports: [ChapterDocumentService],
})
export class ChapterDocumentModule {}
