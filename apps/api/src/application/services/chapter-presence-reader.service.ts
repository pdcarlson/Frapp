import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import { releaseChannel } from '../workers/worker-subscription';

/**
 * Longest a read waits for the chapter's roster. `@here` is the only caller,
 * and a send waits on it, so past this the read gives up and the `@here`
 * reaches only its sender rather than hold the message.
 */
export const CHAPTER_PRESENCE_READ_TIMEOUT_MS = 3_000;

/**
 * How long after the join is acknowledged the read waits for the roster
 * before taking whatever the channel holds. Realtime sends the roster right
 * after the join, so this is only the case where it never comes.
 */
export const CHAPTER_PRESENCE_SYNC_GRACE_MS = 1_000;

/**
 * Most chapters read at once. Each read holds one channel on the API's one
 * Supabase client, which refuses joins past 100 and already carries the push
 * worker's two subscriptions and up to `MAX_PRESENCE_CHANNELS` (80) presence
 * channels. Past this a read answers `null` at once; it takes `@here` landing
 * in this many chapters in the same second or two.
 */
export const MAX_CONCURRENT_CHAPTER_READS = 8;

/**
 * Who is online in a chapter right now, read off the same
 * `presence:chapter:<id>` topic the Directory's dots read (`@repo/hooks`
 * `chapterPresenceTopic`, #3917), for `@here` (2026-11-12).
 *
 * **Online means on the topic now**: anyone with web or the phone app open,
 * whether their dot reads Online, Idle or Do Not Disturb, as Discord's `@here`
 * reaches every member who isn't offline. Invisible publishes nothing, so an
 * invisible member is not here, as on Discord. DND still gets the mention, and
 * the push arrives silent (`notifications.md` § Do Not Disturb). One gap from
 * the dots: a phone member who just switched to another app has left the
 * topic, though the Directory keeps them Idle for `AWAY_GRACE_MS` after, so
 * they are not reached; the server sees only who is on the topic.
 *
 * **One join per read, released straight after.** The roster lives on the
 * Realtime socket and nowhere else (ADR-02), so the only way to read it is to
 * join the topic. Keeping chapters' topics open would spend the per-client
 * channel budget the push worker's presence channels already use
 * (`MAX_PRESENCE_CHANNELS`), for a ping chapters send a few times a day. Reads
 * of one chapter that overlap share one join, and a read that starts while the
 * topic is still being freed waits for that (`realtime-resilience` rule 1).
 *
 * **Advisory, like every presence read** (`presence-topics.ts`): a member can
 * publish an entry for another member, so a forged entry can make someone
 * "here" who isn't. That costs them a mention, which `@everyone` from the same
 * sender could cost them anyway; it never widens who may read anything.
 */
@Injectable()
export class ChapterPresenceReader {
  private readonly logger = new Logger(ChapterPresenceReader.name);
  /** Reads in flight, by chapter: an overlapping read shares the join. */
  private readonly reading = new Map<string, Promise<Set<string> | null>>();
  /** Topics still being freed, by chapter. */
  private readonly releasing = new Map<string, Promise<void>>();

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  /**
   * The `users.id`s on the chapter's presence topic right now, or `null` when
   * the roster could not be read in time.
   */
  onlineUserIds(chapterId: string): Promise<Set<string> | null> {
    const pending = this.reading.get(chapterId);
    if (pending) return pending;
    if (
      this.reading.size + this.releasing.size >=
      MAX_CONCURRENT_CHAPTER_READS
    ) {
      this.logger.warn(
        `chapter presence: ${MAX_CONCURRENT_CHAPTER_READS} chapters already being read; @here in ${chapterId} reaches only its sender`,
      );
      return Promise.resolve(null);
    }
    const read = this.read(chapterId).finally(() => {
      if (this.reading.get(chapterId) === read) this.reading.delete(chapterId);
    });
    this.reading.set(chapterId, read);
    return read;
  }

  private async read(chapterId: string): Promise<Set<string> | null> {
    await this.releasing.get(chapterId);
    let channel: RealtimeChannel | null = null;
    try {
      const opened = this.supabase.channel(`presence:chapter:${chapterId}`, {
        // The clients' own config (`private: true`, #1552): private and public
        // are separate rooms. `presence.enabled` is what makes Realtime send
        // the roster to a joiner that tracks nothing (#2974, the push worker's
        // presence channels).
        config: {
          private: true,
          broadcast: { self: false },
          presence: { key: '', enabled: true },
        },
      });
      channel = opened;
      const synced = await new Promise<boolean>((resolve) => {
        let grace: ReturnType<typeof setTimeout> | null = null;
        const deadline = setTimeout(
          () => finish(false),
          CHAPTER_PRESENCE_READ_TIMEOUT_MS,
        );
        const finish = (ok: boolean) => {
          clearTimeout(deadline);
          if (grace) clearTimeout(grace);
          resolve(ok);
        };
        opened.on('presence', { event: 'sync' }, () => finish(true));
        opened.subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            grace ??= setTimeout(
              () => finish(true),
              CHAPTER_PRESENCE_SYNC_GRACE_MS,
            );
            return;
          }
          // Refused, timed out or closed: realtime-js would retry, but a send
          // is waiting, so give up now with the answer a timeout would give.
          finish(false);
        });
      });
      if (!synced) {
        this.logger.warn(
          `chapter presence: no roster for ${chapterId} (join refused or over ${CHAPTER_PRESENCE_READ_TIMEOUT_MS}ms); @here reaches only its sender`,
        );
        return null;
      }
      return presenceUserIds(opened.presenceState());
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'chapter-presence-read',
        message: `Failed to read who is online in chapter ${chapterId}; @here reaches only its sender`,
        error,
      });
      return null;
    } finally {
      if (channel) this.release(chapterId, channel);
    }
  }

  private release(chapterId: string, channel: RealtimeChannel): void {
    const freed = releaseChannel(channel).finally(() => {
      if (this.releasing.get(chapterId) === freed) {
        this.releasing.delete(chapterId);
      }
    });
    this.releasing.set(chapterId, freed);
  }
}

/**
 * The user ids in a presence state. Every entry is a client's payload, so one
 * is counted only as the Directory's dots count it (`presenceMapFrom` in
 * `@repo/hooks`): a string `userId` and a finite numeric `ts`. An entry the
 * dots skip must not make someone "here" whom every Directory shows offline.
 *
 * Not shared with the push worker's `readPresence`, which reads the chat
 * topic's own pinned payload and counts any entry with a `userId`.
 */
export function presenceUserIds(state: unknown): Set<string> {
  const ids = new Set<string>();
  if (!state || typeof state !== 'object') return ids;
  for (const entries of Object.values(state as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const { userId, ts } = entry as { userId?: unknown; ts?: unknown };
      if (typeof userId !== 'string' || userId.length === 0) continue;
      if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;
      ids.add(userId);
    }
  }
  return ids;
}
