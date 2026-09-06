import { Module } from '@nestjs/common';
import { ChapterDirectoryService } from '../../application/services/chapter-directory.service';
import { ChapterDirectoryController } from '../../interface/controllers/chapter-directory.controller';

@Module({
  controllers: [ChapterDirectoryController],
  providers: [ChapterDirectoryService],
})
export class ChapterDirectoryModule {}
