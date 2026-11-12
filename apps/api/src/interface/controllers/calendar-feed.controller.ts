import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CalendarFeedService } from '../../application/services/calendar-feed/calendar-feed.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { FreeTier } from '../decorators/subscription.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import { CalendarFeedLinkDto } from '../dtos/calendar-feed.dto';

/**
 * The caller's own calendar subscription link in the active chapter (#3322;
 * `spec/behavior/events.md` § Calendar subscription).
 *
 * `members:view` is the gate because it is what every read of events and
 * tasks needs, and the link serves nothing a member couldn't read in the app.
 * `@FreeTier()`: the link is the member's own state, not a paid feature, so a
 * lapsed chapter's members can still get it. The calendar app's fetch is
 * `CalendarFeedFetchController`, which has no guard.
 */
@ApiTags('Calendar feed')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('calendar-feed')
export class CalendarFeedController {
  constructor(private readonly feeds: CalendarFeedService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary:
      "The caller's calendar subscription link, made on first ask. Asking again returns the same link.",
  })
  @ApiOkResponse({ type: CalendarFeedLinkDto })
  ensure(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<CalendarFeedLinkDto> {
    return this.feeds.ensure(chapterId, userId);
  }

  @Post('reset')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Replace the caller\'s calendar link. Calendars subscribed to the old link show nothing from their next check.',
  })
  @ApiOkResponse({ type: CalendarFeedLinkDto })
  reset(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<CalendarFeedLinkDto> {
    return this.feeds.reset(chapterId, userId);
  }
}
