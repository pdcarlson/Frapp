import { Module } from '@nestjs/common';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { ScheduledJobsRepository } from './scheduled-jobs.repository';
import { AttendanceModule } from '../attendance/attendance.module';
import { NotificationModule } from '../notification/notification.module';
import { ChapterConfigModule } from '../chapter-config/chapter-config.module';

/**
 * Scheduled workers for spec-required, time-triggered behavior that no user
 * action initiates. Runs in-process on the API against the already-registered
 * `ScheduleModule.forRoot()`, matching the `chat-push-worker` deployment
 * posture (ADR-09); the scaling watermark for splitting workers out is
 * documented in `docs/internal/ops/DEPLOYMENT.md`.
 *
 * Imports `AttendanceModule` to reuse `markAutoAbsent` rather than restate its
 * eligibility rules, `NotificationModule` for the preference- and
 * quiet-hours-aware fanout, and `ChapterConfigModule` for the per-chapter dues
 * grace that defines "overdue".
 */
@Module({
  imports: [AttendanceModule, NotificationModule, ChapterConfigModule],
  providers: [ScheduledJobsService, ScheduledJobsRepository],
  exports: [ScheduledJobsService],
})
export class ScheduledJobsModule {}
