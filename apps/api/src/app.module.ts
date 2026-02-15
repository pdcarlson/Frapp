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

@Module({
  imports: [CommonModule, DatabaseModule, AuthModule, ChapterModule],
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
