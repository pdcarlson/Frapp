import { Injectable, Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ReportedCron } from './reported-cron.decorator';
import { MeetingDraftService } from '../services/meeting-draft.service';

/**
 * Deletes notes and drafts 30 days after they were asked for, daily, in every
 * chapter (`spec/behavior/meetings.md` § Drafting from notes). Posting,
 * deleting the minutes and clearing the notes each remove them sooner; this
 * is for the draft nobody came back to. Runs whether or not `AI_ENABLED` is
 * on: notes stored while it was on still go after it is turned off. A failure
 * is reported by `@ReportedCron` and the next day tries again.
 */
@Injectable()
export class MeetingDraftRetentionService {
  private readonly logger = new Logger(MeetingDraftRetentionService.name);

  constructor(private readonly drafts: MeetingDraftService) {}

  @ReportedCron(CronExpression.EVERY_DAY_AT_4AM)
  async handleMeetingDraftRetentionSweep(): Promise<void> {
    const deleted = await this.drafts.deleteExpired();
    if (deleted > 0) {
      this.logger.log(`Deleted ${deleted} expired meeting note drafts`);
    }
  }
}
