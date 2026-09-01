import { Module } from '@nestjs/common';
import { ChannelCacheService } from './channel-cache.service';

/**
 * Isolated so `ChannelCacheService` can be shared between `ChatPushWorkerModule`
 * (which reads and populates it) and `ChatModule` (which invalidates it on
 * write) without either pulling in the other's full provider graph.
 */
@Module({
  providers: [ChannelCacheService],
  exports: [ChannelCacheService],
})
export class ChannelCacheModule {}
