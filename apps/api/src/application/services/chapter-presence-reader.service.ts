import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import { releaseChannel } from '../workers/worker-subscription';

/**
 * Longest a read waits for the chapter's roster. `@here` is the only caller,
 * and a send waits on it, so past this the read gives up and the `@here`
 * reaches nobody rather than hold the message.
 */
export const CHAPTER_PRESENCE_READ_TIMEOUT_MS = 3_000;

/**
 * How long after the join is acknowledged the read waits for the roster
 * before taking whatever the channel holds. Realtime sends the roster right
 * after the join, so this is only the case where it never comes.
 */
export const CHAPTER_PRESENCE_SYNC_GRACE_MS = 1_000;

/**
 * Who is online in a chapter right now, read off the same
 * `presence:chapter:<id>` topic the Directory's dots read (`@repo/hooks`
 * `chapterPresenceTopic`, #3917), for `@here` (2026-11-12).
 *
 * **Online means a lit dot**: Online, Idle or Do Not Disturb, as Discord's
 * `@here` reaches every member who isn't offline. A member is on the topic
 * while web or the phone app is open; Invisible publishes nothing, so an
 * invisible member is not here, as on Discord. DND still gets the mention, and
 * the push arrives silent (`notifications.md` § Do Not Disturb).
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
          if (status === 'SUBSCRIBED' && grace === null) {
            grace = setTimeout(
              () => finish(true),
              CHAPTER_PRESENCE_SYNC_GRACE_MS,
            );
          }
        });
      });
      if (!synced) {
        this.logger.warn(
          `chapter presence: no roster for ${chapterId} within ${CHAPTER_PRESENCE_READ_TIMEOUT_MS}ms; @here reaches nobody`,
        );
        return null;
      }
      return presenceUserIds(opened.presenceState());
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'chapter-presence-read',
        message: `Failed to read who is online in chapter ${chapterId}; @here reaches nobody`,
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
 * The user ids in a presence state, whatever else the entries carry. Every
 * entry is a client's payload, so anything without a string `userId` is
 * skipped rather than trusted.
 */
export function presenceUserIds(state: unknown): Set<string> {
  const ids = new Set<string>();
  if (!state || typeof state !== 'object') return ids;
  for (const entries of Object.values(state as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const userId = (entry as { userId?: unknown } | null)?.userId;
      if (typeof userId === 'string' && userId.length > 0) ids.add(userId);
    }
  }
  return ids;
}
