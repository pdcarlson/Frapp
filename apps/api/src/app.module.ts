import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
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
    AttendanceModule,
    PointsModule,
    BillingModule,
  ],
})
export class AppModule {}
