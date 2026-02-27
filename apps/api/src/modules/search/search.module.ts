import { Module } from '@nestjs/common';
import { SearchService } from '../../application/services/search.service';
import { SearchController } from '../../interface/controllers/search.controller';

@Module({
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
