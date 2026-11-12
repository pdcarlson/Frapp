import { Module } from '@nestjs/common';
import { CalendarFeedService } from '../../application/services/calendar-feed/calendar-feed.service';
import { CalendarFeedController } from '../../interface/controllers/calendar-feed.controller';
import { CalendarFeedFetchController } from '../../interface/controllers/calendar-feed-fetch.controller';
import { SupabaseCalendarFeedRepository } from '../../infrastructure/supabase/repositories/supabase-calendar-feed.repository';
import { CALENDAR_FEED_REPOSITORY } from '#domain/repositories/calendar-feed.repository.interface';
import { AuthModule } from '../auth/auth.module';
import { ChapterModule } from '../chapter/chapter.module';
import { EventModule } from '../event/event.module';
import { RbacModule } from '../rbac/rbac.module';
import { TaskModule } from '../task/task.module';

/** Calendar subscription links (#3322). */
@Module({
  // ChapterModule → CHAPTER_REPOSITORY and MEMBER_REPOSITORY; EventModule and
  // TaskModule → the read rules the feed serves through.
  imports: [AuthModule, ChapterModule, EventModule, RbacModule, TaskModule],
  controllers: [CalendarFeedController, CalendarFeedFetchController],
  providers: [
    CalendarFeedService,
    {
      provide: CALENDAR_FEED_REPOSITORY,
      useClass: SupabaseCalendarFeedRepository,
    },
  ],
})
export class CalendarFeedModule {}
