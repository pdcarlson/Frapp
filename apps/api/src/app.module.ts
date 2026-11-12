import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { SentryModule } from '@sentry/nestjs/setup';
import { CustomThrottlerGuard } from './interface/guards/custom-throttler.guard';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { SupabaseModule } from './infrastructure/supabase/supabase.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { ChapterModule } from './modules/chapter/chapter.module';
import { MemberModule } from './modules/member/member.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { InviteModule } from './modules/invite/invite.module';
import { EventModule } from './modules/event/event.module';
import { MeetingModule } from './modules/meeting/meeting.module';
import { MeetingDraftModule } from './modules/meeting/meeting-draft.module';
import { MeetingRecordingModule } from './modules/meeting/meeting-recording.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { PointsModule } from './modules/points/points.module';
import { BillingModule } from './modules/billing/billing.module';
import { FinancialInvoiceModule } from './modules/financial-invoice/financial-invoice.module';
import { BackworkModule } from './modules/backwork/backwork.module';
import { ChatModule } from './modules/chat/chat.module';
import { ServiceEntryModule } from './modules/service-entry/service-entry.module';
import { TaskModule } from './modules/task/task.module';
import { AiSuggestionModule } from './modules/ai-suggestion/ai-suggestion.module';
import { PledgeClassModule } from './modules/pledge-class/pledge-class.module';
import { RushModule } from './modules/rush/rush.module';
import { NotificationModule } from './modules/notification/notification.module';
import { StudyModule } from './modules/study/study.module';
import { ChapterDocumentModule } from './modules/chapter-document/chapter-document.module';
import { PollModule } from './modules/poll/poll.module';
import { SemesterRolloverModule } from './modules/semester-rollover/semester-rollover.module';
import { ReportModule } from './modules/report/report.module';
import { SearchModule } from './modules/search/search.module';
import { ActivityFeedModule } from './modules/activity-feed/activity-feed.module';
import { ActivityModule } from './modules/activity/activity.module';
import { GoalsModule } from './modules/goals/goals.module';
import { AiRunsModule } from './modules/ai-runs/ai-runs.module';
import { CorpusModule } from './modules/corpus/corpus.module';
import { ChapterConfigModule } from './modules/chapter-config/chapter-config.module';
import { ChapterDirectoryModule } from './modules/chapter-directory/chapter-directory.module';
import { ChatBridgeWorkerModule } from './modules/chat-bridge-worker/chat-bridge-worker.module';
import { ChatPushWorkerModule } from './modules/chat-push-worker/chat-push-worker.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { ScheduledJobsModule } from './modules/scheduled-jobs/scheduled-jobs.module';
import { DiscordImportModule } from './modules/discord-import/discord-import.module';
import { ClientPolicyModule } from './modules/client-policy/client-policy.module';
import { DevLogModule } from './modules/dev-log/dev-log.module';
import { AiModule } from './modules/ai/ai.module';
import { AiConsentModule } from './modules/ai-consent/ai-consent.module';
import { AskModule } from './modules/ask/ask.module';
import { ActModule } from './modules/act/act.module';
import { ChatCatchUpModule } from './modules/chat-catch-up/chat-catch-up.module';
import { AiReportModule } from './modules/ai-report/ai-report.module';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    // Transaction names on HTTP spans. Does not replace AllExceptionsFilter —
    // 5xx still go through toReportableError, and 401/403/429 stay
    // security_event records. SentryGlobalFilter is deliberately not
    // registered (it would capture a non-Error throwable raw and
    // double-report every 5xx).
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([
      { name: 'read', ttl: 60_000, limit: 100 },
      { name: 'write', ttl: 60_000, limit: 30 },
    ]),
    ScheduleModule.forRoot(),
    SupabaseModule,
    HealthModule,
    AuthModule,
    UserModule,
    ChapterModule,
    MemberModule,
    RbacModule,
    InviteModule,
    EventModule,
    MeetingModule,
    AttendanceModule,
    PointsModule,
    BillingModule,
    FinancialInvoiceModule,
    BackworkModule,
    ChatModule,
    ServiceEntryModule,
    TaskModule,
    AiSuggestionModule,
    PledgeClassModule,
    RushModule,
    NotificationModule,
    StudyModule,
    ChapterDocumentModule,
    PollModule,
    SemesterRolloverModule,
    ReportModule,
    SearchModule,
    ActivityFeedModule,
    ActivityModule,
    GoalsModule,
    AiRunsModule,
    CorpusModule,
    ChapterConfigModule,
    ChapterDirectoryModule,
    ChatBridgeWorkerModule,
    ChatPushWorkerModule,
    AnalyticsModule,
    ScheduledJobsModule,
    DiscordImportModule,
    ClientPolicyModule,
    DevLogModule,
    AiModule,
    AiConsentModule,
    AskModule,
    ActModule,
    ChatCatchUpModule,
    AiReportModule,
    // After the AI modules it imports, so their routes keep their place in
    // the exported contract.
    MeetingDraftModule,
    MeetingRecordingModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
  ],
})
export class AppModule {}
