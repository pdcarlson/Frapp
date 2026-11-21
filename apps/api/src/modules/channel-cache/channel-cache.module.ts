import { Module } from '@nestjs/common';
import { ChannelCacheService } from '../../application/services/channel-cache.service';

/**
 * Isolated so `ChannelCacheService` can be shared between `ChatPushWorkerModule`
 * (which reads and populates it) and the modules that invalidate it on write
 * (`ChatModule`, `MemberModule`, and `DiscordImportModule` for the import
 * purge, #2905) without any of them pulling in another's full provider graph.
 */
@Module({
  providers: [ChannelCacheService],
  exports: [ChannelCacheService],
})
export class ChannelCacheModule {}
