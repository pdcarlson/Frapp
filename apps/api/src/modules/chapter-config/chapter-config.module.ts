import { Module } from '@nestjs/common';
import { ChapterConfigService } from '../../application/services/chapter-config.service';
import { ChapterConfigController } from '../../interface/controllers/chapter-config.controller';

@Module({
  controllers: [ChapterConfigController],
  providers: [ChapterConfigService],
  exports: [ChapterConfigService],
})
export class ChapterConfigModule {}
