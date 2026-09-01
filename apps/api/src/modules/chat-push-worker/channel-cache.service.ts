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
 * either field must call {@link invalidate} — see `ChatService.updateChannel`
 * and `deleteChannel`. No route mutates `member_ids` after creation today
 * (#1302 tracks adding one); whoever builds it must call `invalidate` there
 * too.
 *
 * `set` is fenced by an epoch counter rather than writing unconditionally.
 * Without it, a read started before a write's `invalidate()` call can still
 * resolve *after* it — an in-flight `SELECT` racing an `UPDATE` — and
 * `set()` would silently re-cache the pre-write row for a fresh TTL,
 * defeating the eviction this class exists to provide. `invalidate` bumps
 * the epoch; a caller reading the channel must capture {@link getEpoch}
 * *before* issuing its read and pass that value back to `set`, which
 * discards the write if the epoch has since moved.
 */
@Injectable()
export class ChannelCacheService {
  private readonly cache = new Map<
    string,
    { row: CachedChannelRow; expiresAt: number }
  >();
  private readonly epoch = new Map<string, number>();

  get(channelId: string): CachedChannelRow | null {
    const cached = this.cache.get(channelId);
    if (cached && cached.expiresAt > Date.now()) return cached.row;
    return null;
  }

  /**
   * The channel's current epoch, bumped by every {@link invalidate}. Capture
   * this before starting an async read of the channel row, then pass it back
   * to {@link set} so a read that started before an intervening write cannot
   * clobber that write's eviction.
   */
  getEpoch(channelId: string): number {
    return this.epoch.get(channelId) ?? 0;
  }

  /**
   * Cache a freshly read row, unless `epoch` (captured via {@link getEpoch}
   * before the read started) is stale — i.e. `invalidate` ran on this channel
   * after the read began. A stale write is silently discarded rather than
   * cached: the next read will simply refetch, which is what should have
   * happened had the write finished first.
   */
  set(channelId: string, row: CachedChannelRow, epoch: number): void {
    if (epoch !== this.getEpoch(channelId)) return;
    this.cache.set(channelId, {
      row,
      expiresAt: Date.now() + CHANNEL_CACHE_TTL_MS,
    });
  }

  /**
   * Evict a channel's cached authorization inputs and fence out any read
   * already in flight. Call after any write that can change `member_ids` or
   * `required_permissions`, and on delete — a missed write path restores the
   * staleness window this cache exists to bound.
   */
  invalidate(channelId: string): void {
    this.cache.delete(channelId);
    this.epoch.set(channelId, this.getEpoch(channelId) + 1);
  }
}
