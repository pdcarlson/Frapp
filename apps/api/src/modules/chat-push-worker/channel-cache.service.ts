import { Injectable } from '@nestjs/common';

/** How long a cached channel row may inform an authorization decision, absent an explicit invalidation. */
const CHANNEL_CACHE_TTL_MS = 30_000;

export interface CachedChannelRow {
  id: string;
  chapter_id: string;
  name: string;
  is_read_only: boolean | null;
  type: string;
  member_ids: string[] | null;
  required_permissions: string[] | null;
}

/**
 * Shared cache of `chat_channels` rows, keyed by channel id.
 *
 * Lives in its own module (no `OnApplicationBootstrap`/Realtime lifecycle of
 * its own) specifically so it can be imported by both `ChatPushWorkerModule`
 * and `ChatModule` without pulling the push worker's Realtime subscription
 * into the request path — the same reason `ChatModule` provides
 * `ChatNotificationPreferenceRepository` directly instead of importing
 * `ChatPushWorkerModule` wholesale.
 *
 * `member_ids` and `required_permissions` are authorization inputs, not
 * display data: they decide who receives a push containing message content.
 * The TTL bounds staleness as a backstop, but any write path that can change
 * either field must call {@link invalidate} — see `ChatService.updateChannel`.
 * No route mutates `member_ids` after creation today (#1302 tracks adding
 * one); whoever builds it must call `invalidate` there too.
 */
@Injectable()
export class ChannelCacheService {
  private readonly cache = new Map<
    string,
    { row: CachedChannelRow; expiresAt: number }
  >();

  get(channelId: string): CachedChannelRow | null {
    const cached = this.cache.get(channelId);
    if (cached && cached.expiresAt > Date.now()) return cached.row;
    return null;
  }

  set(channelId: string, row: CachedChannelRow): void {
    this.cache.set(channelId, {
      row,
      expiresAt: Date.now() + CHANNEL_CACHE_TTL_MS,
    });
  }

  /**
   * Evict a channel's cached authorization inputs. Call after any write that
   * can change `member_ids` or `required_permissions` — a missed write path
   * restores the staleness window this cache exists to bound.
   */
  invalidate(channelId: string): void {
    this.cache.delete(channelId);
  }
}
