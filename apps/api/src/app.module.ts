import { Module } from '@nestjs/common';
import { AppController } from './interface/controllers/app.controller';
import { AppService } from './application/services/app.service';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './interface/filters/all-exceptions.filter';
import { LoggingInterceptor } from './interface/interceptors/logging.interceptor';
import { DatabaseModule } from './modules/database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { ChapterModule } from './modules/chapter/chapter.module';
import { CommonModule } from './modules/common/common.module';
import { BillingModule } from './modules/billing/billing.module';
import { InviteModule } from './modules/invite/invite.module';
import { BackworkModule } from './modules/backwork/backwork.module';
import { StorageModule } from './modules/storage/storage.module';
import { UserModule } from './modules/user/user.module';
import { PointsModule } from './modules/points/points.module';
import { EventModule } from './modules/event/event.module';
import { NotificationModule } from './modules/notification/notification.module';
import { ChatModule } from './modules/chat/chat.module';
import { StudyModule } from './modules/study/study.module';
import { FinancialModule } from './modules/financial/financial.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { MemberModule } from './modules/member/member.module';

@Module({
  imports: [
    CommonModule,
    DatabaseModule,
    AuthModule,
    ChapterModule,
    BillingModule,
    InviteModule,
    BackworkModule,
    StorageModule,
    UserModule,
    PointsModule,
    EventModule,
    NotificationModule,
    ChatModule,
    StudyModule,
    FinancialModule,
    RbacModule,
    MemberModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
