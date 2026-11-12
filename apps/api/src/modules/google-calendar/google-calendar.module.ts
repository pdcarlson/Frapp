import { Module } from '@nestjs/common';
import { GoogleCalendarService } from '../../application/services/google-calendar/google-calendar.service';
import { GoogleCalendarSyncService } from '../../application/services/google-calendar/google-calendar-sync.service';
import { GoogleCalendarSyncSweepService } from '../../application/workers/google-calendar-sync-sweep.service';
import { GoogleCalendarController } from '../../interface/controllers/google-calendar.controller';
import { GoogleCalendarCallbackController } from '../../interface/controllers/google-calendar-callback.controller';
import { SupabaseGoogleCalendarRepository } from '../../infrastructure/supabase/repositories/supabase-google-calendar.repository';
import { GoogleCalendarApiClient } from '../../infrastructure/google/google-calendar-api.client';
import { GOOGLE_CALENDAR_REPOSITORY } from '#domain/repositories/google-calendar.repository.interface';
import { GOOGLE_CALENDAR_API } from '#domain/adapters/google-calendar.interface';
import { AuthModule } from '../auth/auth.module';
import { CalendarFeedModule } from '../calendar-feed/calendar-feed.module';
import { ChapterModule } from '../chapter/chapter.module';
import { RbacModule } from '../rbac/rbac.module';

/** Google Calendar connections and their sync (#3322, step 2). */
@Module({
  // CalendarFeedModule → what a member's calendar holds, the same items the
  // subscription link serves; ChapterModule → CHAPTER_REPOSITORY.
  imports: [AuthModule, CalendarFeedModule, ChapterModule, RbacModule],
  controllers: [GoogleCalendarController, GoogleCalendarCallbackController],
  providers: [
    GoogleCalendarService,
    GoogleCalendarSyncService,
    GoogleCalendarSyncSweepService,
    {
      provide: GOOGLE_CALENDAR_REPOSITORY,
      useClass: SupabaseGoogleCalendarRepository,
    },
    { provide: GOOGLE_CALENDAR_API, useClass: GoogleCalendarApiClient },
  ],
})
export class GoogleCalendarModule {}
