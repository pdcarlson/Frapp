import { Module } from '@nestjs/common';
import { ChapterDirectoryService } from '../../application/services/chapter-directory.service';
import { ChapterDirectoryController } from '../../interface/controllers/chapter-directory.controller';
import { CHAPTER_DIRECTORY_REPOSITORY } from '#domain/repositories/chapter-directory.repository.interface';
import { SupabaseChapterDirectoryRepository } from '../../infrastructure/supabase/repositories/supabase-chapter-directory.repository';

@Module({
  controllers: [ChapterDirectoryController],
  providers: [
    ChapterDirectoryService,
    {
      provide: CHAPTER_DIRECTORY_REPOSITORY,
      useClass: SupabaseChapterDirectoryRepository,
    },
  ],
})
export class ChapterDirectoryModule {}
