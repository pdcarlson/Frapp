import { Inject, Injectable, Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ReportedCron } from './reported-cron.decorator';
import {
  CHAT_SCHEDULED_MESSAGE_REPOSITORY,
  type IChatScheduledMessageRepository,
} from '#domain/repositories/chat-scheduled-message.repository.interface';
import {
  ChatScheduledMessageService,
  SCHEDULE_LEASE_MS,
} from '../services/chat-scheduled-message.service';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';

/** Due messages read at a time, across every chapter. */
export const SCHEDULED_MESSAGE_BATCH = 50;
/** How long one tick keeps sending before it leaves the rest to the next. */
export const SWEEP_BUDGET_MS = 45 * 1000;

/**
 * Posts scheduled chat messages when they are due (#4956). Every minute it
 * reads the due rows no send holds, batch after batch, claims each with a
 * compare-and-set (so on several API replicas only one posts it), and hands
 * it to {@link ChatScheduledMessageService.deliver}. A message usually posts
 * within a minute of its time; a tick stops after 45 seconds and leaves the
 * rest to the next. Ticks on one replica don't overlap.
 */
@Injectable()
export class ChatScheduledMessageSweepService {
  private readonly logger = new Logger(ChatScheduledMessageSweepService.name);
  private running = false;

  constructor(
    @Inject(CHAT_SCHEDULED_MESSAGE_REPOSITORY)
    private readonly repo: IChatScheduledMessageRepository,
    private readonly scheduled: ChatScheduledMessageService,
  ) {}

  @ReportedCron(CronExpression.EVERY_MINUTE)
  async handleScheduledMessageSweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep(Date.now());
    } finally {
      this.running = false;
    }
  }

  async sweep(
    now: number,
    clock: () => number = Date.now,
  ): Promise<{ sent: number; failed: number; retry: number }> {
    const nowIso = new Date(now).toISOString();
    const tally = { sent: 0, failed: 0, retry: 0 };
    let lastError: unknown = null;
    const tried = new Set<string>();
    // Batch after batch while rows are due, so a popular time (8 AM tomorrow)
    // drains in this tick, within a time budget that keeps ticks from piling up.
    while (clock() - now < SWEEP_BUDGET_MS) {
      const due = (
        await this.repo.findDue(nowIso, SCHEDULED_MESSAGE_BATCH)
      ).filter((row) => !tried.has(row.id));
      if (due.length === 0) break;
      for (const row of due) {
        tried.add(row.id);
        if (clock() - now >= SWEEP_BUDGET_MS) break;
        // One row's fault never stops the rest: it keeps its lease and is
        // taken again once the lease runs out.
        try {
          // The lease runs from the claim, not the tick, so a row claimed
          // late in a slow tick isn't free to another replica mid-send. Only
          // while still due: an edit may have moved it later since the read.
          const at = clock();
          const claimed = await this.repo.claim(
            row,
            new Date(at + SCHEDULE_LEASE_MS).toISOString(),
            new Date(at).toISOString(),
            nowIso,
          );
          if (!claimed) continue;
          // As the claim found it: an edit since the read is what posts.
          const result = await this.scheduled.deliver(claimed);
          tally[result.outcome] += 1;
          if (result.outcome === 'retry') lastError = result.cause;
        } catch (error) {
          tally.retry += 1;
          lastError = error;
        }
      }
    }
    if (tally.retry > 0) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'chat-scheduled-message-sweep',
        message: `${tally.retry} scheduled message send(s) broke on the way; each is tried again after its lease`,
        error: lastError,
      });
    }
    return tally;
  }
}
