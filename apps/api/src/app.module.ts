import { Module } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
import { AttendanceModule } from './modules/attendance/attendance.module';
import { PointsModule } from './modules/points/points.module';
import { BillingModule } from './modules/billing/billing.module';
import { FinancialInvoiceModule } from './modules/financial-invoice/financial-invoice.module';
import { BackworkModule } from './modules/backwork/backwork.module';
import { ChatModule } from './modules/chat/chat.module';
import { ServiceEntryModule } from './modules/service-entry/service-entry.module';
import { TaskModule } from './modules/task/task.module';
import { NotificationModule } from './modules/notification/notification.module';
import { StudyModule } from './modules/study/study.module';
import { ChapterDocumentModule } from './modules/chapter-document/chapter-document.module';
import { PollModule } from './modules/poll/poll.module';
import { SemesterRolloverModule } from './modules/semester-rollover/semester-rollover.module';
import { ReportModule } from './modules/report/report.module';
import { SearchModule } from './modules/search/search.module';
import { validateEnv } from './config/env.validation';

/** Methods throttled by the `read` bucket (100/min); mutating methods use `write` (30/min). */
const READ_THROTTLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function httpMethod(context: ExecutionContext): string | undefined {
  try {
    const req = context.switchToHttp().getRequest<{ method?: string }>();
    return req?.method;
  } catch {
    return undefined;
  }
}

function skipReadThrottler(context: ExecutionContext): boolean {
  const method = httpMethod(context);
  if (!method) {
    return true;
  }
  return !READ_THROTTLE_METHODS.has(method.toUpperCase());
}

function skipWriteThrottler(context: ExecutionContext): boolean {
  const method = httpMethod(context);
  if (!method) {
    return true;
  }
  return READ_THROTTLE_METHODS.has(method.toUpperCase());
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([
      {
        name: 'read',
        ttl: 60_000,
        limit: 100,
        skipIf: skipReadThrottler,
      },
      {
        name: 'write',
        ttl: 60_000,
        limit: 30,
        skipIf: skipWriteThrottler,
      },
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
    AttendanceModule,
    PointsModule,
    BillingModule,
    FinancialInvoiceModule,
    BackworkModule,
    ChatModule,
    ServiceEntryModule,
    TaskModule,
    NotificationModule,
    StudyModule,
    ChapterDocumentModule,
    PollModule,
    SemesterRolloverModule,
    ReportModule,
    SearchModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
