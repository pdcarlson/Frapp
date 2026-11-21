import { Injectable, Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ReportedCron } from './reported-cron.decorator';
import { MeetingRecordingService } from '../services/meeting-recording.service';

/**
 * Keeps meeting audio from outliving its use (`spec/behavior/meetings.md`
 * § Uploading a recording). The transcription deletes its own file when it
 * ends; these are for everything that didn't end that way.
 *
 * Both run whether or not `AI_ENABLED` is on: audio and transcripts stored
 * while it was on still go after it is turned off. A failure is reported by
 * `@ReportedCron` and the next tick tries again.
 */
@Injectable()
export class MeetingRecordingSweepService {
  private readonly logger = new Logger(MeetingRecordingSweepService.name);

  constructor(private readonly recordings: MeetingRecordingService) {}

  /**
   * Abandoned uploads, transcriptions whose run died, and any file in the
   * bucket that no recording names any more (its minutes were posted or
   * deleted, or its uploader's account was).
   */
  @ReportedCron(CronExpression.EVERY_30_MINUTES)
  async handleMeetingAudioSweep(): Promise<void> {
    const deleted = await this.recordings.sweepAudio();
    if (deleted > 0) {
      this.logger.log(`Deleted ${deleted} leftover meeting audio files`);
    }
  }

  /** Recordings and transcripts 30 days after upload, like the notes. */
  @ReportedCron(CronExpression.EVERY_DAY_AT_4AM)
  async handleMeetingRecordingRetentionSweep(): Promise<void> {
    const deleted = await this.recordings.deleteExpired();
    if (deleted > 0) {
      this.logger.log(`Deleted ${deleted} expired meeting recordings`);
    }
  }
}
