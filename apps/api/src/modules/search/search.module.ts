import { Module } from '@nestjs/common';
import { SearchService } from '../../application/services/search.service';
import { SearchController } from '../../interface/controllers/search.controller';
// RbacModule → RbacService: search resolves channel-gating permissions through
// the same bridged resolver as chat, so custom-role capabilities count here.
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [RbacModule],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
