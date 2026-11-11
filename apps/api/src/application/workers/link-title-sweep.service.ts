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
  type LinkTitleResult,
} from '#domain/adapters/link-title.interface';
import { ACTIVITY_LINK_WINDOW_DAYS } from '../services/activity-link.service';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';

/**
 * Links read per tick, across every chapter, newest first. Each read is
 * sequential and capped at 5 seconds (`LINK_TITLE_TIMEOUT_MS`), so a tick of
 * slow pages still ends inside its minute. The budget is the whole API's, not
 * a chapter's: 600 links an hour, shared by every chapter.
 */
export const LINK_TITLE_BATCH = 10;
/** How long a read that failed on the way waits before it is tried again. */
export const LINK_TITLE_RETRY_AFTER_MS = 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reads each sign-up link's page title in the background (#4187,
 * `spec/behavior/activity.md` § Links), so Activity's Links rows can be
 * titled by name. The Activity read never fetches: it serves what this
 * stored, and a link not read yet shows its kind, as before.
 *
 * Each link is claimed just before its read, with a compare-and-set on its
 * attempt count, so on several API replicas only one reads it each time. A
 * definite answer (a name, or a page with none) ends it; a read that broke
 * on the way (a timeout, a network error, a 5xx or rate limit, or this
 * process dying mid-read) leaves it to be tried again an hour later, three
 * tries at most (`MAX_LINK_TITLE_ATTEMPTS`). A tick whose reads failed
 * reports it, so a fault that fails every read is seen rather than spending
 * the links' tries in silence. Ticks on one replica don't overlap.
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
   * One tick: read up to {@link LINK_TITLE_BATCH} links waiting for a name,
   * each distinct URL once, and store what each read came to. Returns how
   * many links it read, titled, and found failing.
   */
  async sweep(
    now: number,
  ): Promise<{ read: number; titled: number; failed: number }> {
    const pending = await this.linkRepo.findTitlePending({
      since: new Date(now - ACTIVITY_LINK_WINDOW_DAYS * DAY_MS).toISOString(),
      retryBefore: new Date(now - LINK_TITLE_RETRY_AFTER_MS).toISOString(),
      limit: LINK_TITLE_BATCH,
    });

    // The same form posted twice is one read.
    const byUrl = new Map<string, LinkTitleCandidate[]>();
    for (const link of pending) {
      byUrl.set(link.url, [...(byUrl.get(link.url) ?? []), link]);
    }

    const tally = { read: 0, titled: 0, failed: 0 };
    const reasons = new Set<string>();
    for (const [url, links] of byUrl) {
      const won: LinkTitleCandidate[] = [];
      for (const link of links) {
        if (await this.linkRepo.claimForTitle(link)) won.push(link);
      }
      if (won.length === 0) continue;
      const result = await this.fetcher.fetchTitle(url);
      tally.read += won.length;
      if (result.outcome === 'failed') {
        // Left claimed with one more try spent: read again after the wait.
        tally.failed += won.length;
        reasons.add(result.reason);
        continue;
      }
      tally.titled += await this.finish(won, result);
    }

    if (tally.failed > 0) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'link-title-sweep-read',
        message: `link title reads failed for ${tally.failed} of ${tally.read} link(s); each is tried again in an hour`,
        tags: { reason: [...reasons].sort().join(',') },
      });
    }
    return tally;
  }

  /** Stores a definite answer; returns how many links got a name. */
  private async finish(
    links: LinkTitleCandidate[],
    result: Exclude<LinkTitleResult, { outcome: 'failed' }>,
  ): Promise<number> {
    const title = result.outcome === 'title' ? result.title : null;
    const byChapter = new Map<string, string[]>();
    for (const link of links) {
      byChapter.set(link.chapter_id, [
        ...(byChapter.get(link.chapter_id) ?? []),
        link.id,
      ]);
    }
    let titled = 0;
    for (const [chapterId, ids] of byChapter) {
      try {
        await this.linkRepo.finishTitle(chapterId, ids, title);
        if (title !== null) titled += ids.length;
      } catch (error) {
        // The links stay claimed with a try spent, so the next try after the
        // wait writes them; meanwhile their rows keep their kind.
        reportCaughtFailure(this.logger, {
          level: 'warning',
          site: 'link-title-sweep-write',
          message: `link title write failed for ${ids.length} link(s)`,
          error,
        });
      }
    }
    return titled;
  }
}
