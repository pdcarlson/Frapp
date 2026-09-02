import { Module } from '@nestjs/common';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { ScheduledJobsRepository } from './scheduled-jobs.repository';
import { AttendanceModule } from '../attendance/attendance.module';
import { NotificationModule } from '../notification/notification.module';
import { ChapterConfigModule } from '../chapter-config/chapter-config.module';
import { ChapterModule } from '../chapter/chapter.module';
import { ReportRetentionModule } from '../report-retention/report-retention.module';
import { PollModule } from '../poll/poll.module';

/**
 * Scheduled workers for spec-required, time-triggered behavior that no user
 * action initiates. Runs in-process on the API against the already-registered
 * `ScheduleModule.forRoot()`, matching the in-process posture the chat workers
 * use (ADR-09).
 *
 * Unlike those workers, a `@Cron` handler fires on **every** replica rather
 * than following a single Realtime subscription, so multi-instance safety here
 * comes from the `scheduled_notification_dispatches` claim rather than from
 * the deployment topology — see `docs/internal/ops/DEPLOYMENT.md` §5.6.
 *
 * Imports `AttendanceModule` to reuse `markAutoAbsent` rather than restate its
 * eligibility rules, `NotificationModule` for the preference- and
 * quiet-hours-aware fanout, `ChapterConfigModule` for the per-chapter dues
 * grace that defines "overdue", `ChapterModule` for `MEMBER_REPOSITORY`, used
 * to confirm a task's assigner still belongs to the chapter, and
 * `ReportRetentionModule` for the generated-report reaper, and `PollModule`
 * for the `system_audit` expiry announcement (#404).
 */
@Module({
  imports: [
    AttendanceModule,
    NotificationModule,
    ChapterConfigModule,
    ChapterModule,
    ReportRetentionModule,
    PollModule,
  ],
  providers: [ScheduledJobsService, ScheduledJobsRepository],
  exports: [ScheduledJobsService],
})
export class ScheduledJobsModule {}
