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

/** Due messages read per tick, across every chapter. */
export const SCHEDULED_MESSAGE_BATCH = 50;

/**
 * Posts scheduled chat messages when they are due (#4956). Every minute it
 * reads the due rows no send holds, claims each with a compare-and-set (so on
 * several API replicas only one posts it), and hands it to
 * {@link ChatScheduledMessageService.deliver}. A message therefore posts
 * within about a minute of its time. Ticks on one replica don't overlap.
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
  ): Promise<{ sent: number; failed: number; retry: number }> {
    const nowIso = new Date(now).toISOString();
    const due = await this.repo.findDue(nowIso, SCHEDULED_MESSAGE_BATCH);
    const tally = { sent: 0, failed: 0, retry: 0 };
    let lastError: unknown = null;
    for (const row of due) {
      // One row's fault never stops the rest: it keeps its lease and is
      // taken again once the lease runs out.
      try {
        const claimed = await this.repo.claim(
          row,
          new Date(now + SCHEDULE_LEASE_MS).toISOString(),
          nowIso,
        );
        if (!claimed) continue;
        const result = await this.scheduled.deliver({
          ...row,
          attempts: row.attempts + 1,
        });
        tally[result.outcome] += 1;
        if (result.outcome === 'retry') lastError = result.cause;
      } catch (error) {
        tally.retry += 1;
        lastError = error;
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
