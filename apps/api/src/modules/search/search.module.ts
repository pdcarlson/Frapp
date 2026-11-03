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
import { SEARCH_REPOSITORY } from '#domain/repositories/search.repository.interface';
import { SupabaseSearchRepository } from '../../infrastructure/supabase/repositories/supabase-search.repository';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';

@Module({
  imports: [RbacModule, ChatBlockModule],
  controllers: [SearchController],
  providers: [
    SearchService,
    { provide: SEARCH_REPOSITORY, useClass: SupabaseSearchRepository },
    // The caller's membership (role ids for event visibility, and whether they
    // may read any channel). Provided directly: a stateless wrapper over the
    // shared client.
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
  ],
})
export class SearchModule {}
