import { Injectable, Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ReportedCron } from './reported-cron.decorator';
import { AttendanceService } from '../services/attendance.service';

/**
 * Deletes where each event's check-in QR screen was, once the event's
 * check-in has closed (#4532, `spec/behavior/events.md` § Check-In). Nothing
 * reads a row past its `expires_at` anyway; this is what makes "kept only
 * while check-in is open" true of the database too. Every 10 minutes, so a
 * location outlives the window by at most that. Safe on every replica: a
 * delete of rows already gone deletes nothing. A failure is reported by
 * `@ReportedCron` and the next run tries again.
 */
@Injectable()
export class CheckInScreenSweepService {
  private readonly logger = new Logger(CheckInScreenSweepService.name);

  constructor(private readonly attendance: AttendanceService) {}

  @ReportedCron(CronExpression.EVERY_10_MINUTES)
  async handleCheckInScreenSweep(): Promise<void> {
    const deleted = await this.attendance.deleteExpiredCheckInScreens();
    if (deleted > 0) {
      this.logger.log(`Deleted ${deleted} closed check-in screen locations`);
    }
  }
}
