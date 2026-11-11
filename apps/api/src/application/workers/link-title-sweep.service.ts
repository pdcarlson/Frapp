import { Inject, Injectable, Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ReportedCron } from './reported-cron.decorator';
import {
  CHAT_MESSAGE_LINK_REPOSITORY,
  type IChatMessageLinkRepository,
  type LinkTitleCandidate,
} from '#domain/repositories/chat-message-link.repository.interface';
import {
  LINK_TITLE_FETCHER,
  type ILinkTitleFetcher,
} from '#domain/adapters/link-title.interface';
import { ACTIVITY_LINK_WINDOW_DAYS } from '../services/activity-link.service';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';

/**
 * Links claimed per tick. Each read is sequential and capped at 5 seconds
 * (`LINK_TITLE_TIMEOUT_MS`), so a tick of slow pages still ends inside its
 * minute; a busy chapter's backlog drains at 600 links an hour.
 */
export const LINK_TITLE_BATCH = 10;

/**
 * Reads each sign-up link's page title once, in the background (#4187,
 * `spec/behavior/activity.md` § Links), so Activity's Links rows can be
 * titled by name. The Activity read never fetches: it serves what this
 * stored, and a link not read yet shows its kind, as before.
 *
 * Safe on every API replica: a link is claimed with a compare-and-set on
 * `title_checked_at` before its page is opened, so only one replica reads it,
 * and a claimed link is never read again, title or not. A process that dies
 * mid-read leaves that link with no title, which is the same row it had.
 * Ticks on one replica don't overlap: a tick still running skips the next.
 */
@Injectable()
export class LinkTitleSweepService {
  private readonly logger = new Logger(LinkTitleSweepService.name);
  private running = false;

  constructor(
    @Inject(CHAT_MESSAGE_LINK_REPOSITORY)
    private readonly linkRepo: IChatMessageLinkRepository,
    @Inject(LINK_TITLE_FETCHER)
    private readonly fetcher: ILinkTitleFetcher,
  ) {}

  @ReportedCron(CronExpression.EVERY_MINUTE)
  async handleLinkTitleSweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep(Date.now());
    } finally {
      this.running = false;
    }
  }

  /**
   * One tick: claim up to {@link LINK_TITLE_BATCH} unread links posted inside
   * Activity's window, read each distinct URL once, and store the titles
   * found. Returns how many links it claimed and titled.
   */
  async sweep(now: number): Promise<{ claimed: number; titled: number }> {
    const since = new Date(
      now - ACTIVITY_LINK_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const candidates = await this.linkRepo.findTitleUnchecked({
      since,
      limit: LINK_TITLE_BATCH,
    });
    if (candidates.length === 0) return { claimed: 0, titled: 0 };
    const claimed = await this.linkRepo.claimForTitle(
      candidates.map((link) => link.id),
    );

    // The same form posted twice is one read.
    const byUrl = new Map<string, LinkTitleCandidate[]>();
    for (const link of claimed) {
      byUrl.set(link.url, [...(byUrl.get(link.url) ?? []), link]);
    }

    let titled = 0;
    for (const [url, links] of byUrl) {
      const title = await this.fetcher.fetchTitle(url);
      if (title === null) continue;
      const byChapter = new Map<string, string[]>();
      for (const link of links) {
        byChapter.set(link.chapter_id, [
          ...(byChapter.get(link.chapter_id) ?? []),
          link.id,
        ]);
      }
      for (const [chapterId, ids] of byChapter) {
        try {
          await this.linkRepo.setTitle(chapterId, ids, title);
          titled += ids.length;
        } catch (error) {
          // The links stay claimed with no title, so their rows keep their
          // kind: a lost name, not a broken row. The rest of the tick goes on.
          reportCaughtFailure(this.logger, {
            level: 'warning',
            site: 'link-title-sweep-write',
            message: `link title write failed for ${ids.length} link(s)`,
            error,
          });
        }
      }
    }
    return { claimed: claimed.length, titled };
  }
}
