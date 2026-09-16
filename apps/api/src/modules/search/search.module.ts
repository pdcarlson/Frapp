import { Module } from '@nestjs/common';
import { SearchService } from '../../application/services/search.service';
import { SearchController } from '../../interface/controllers/search.controller';
// RbacModule → RbacService: search resolves channel-gating permissions through
// the same bridged resolver as chat, so custom-role capabilities count here.
import { RbacModule } from '../rbac/rbac.module';
// ChatBlockModule → ChatBlockService: message search serves chat content to a
// named viewer, so it applies the caller's block list like the timeline does
// (#2257).
import { ChatBlockModule } from '../chat-block/chat-block.module';

@Module({
  imports: [RbacModule, ChatBlockModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
