import { Module } from '@nestjs/common';
import { ChapterGuard } from '../../interface/guards/chapter.guard';

@Module({
  providers: [ChapterGuard],
  exports: [ChapterGuard],
})
export class ChapterModule {}
