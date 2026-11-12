import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { GoogleCalendarService } from '../../application/services/google-calendar/google-calendar.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import {
  FreeTier,
  SubscriptionExempt,
} from '../decorators/subscription.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  ConfirmGoogleCalendarConnectDto,
  GoogleCalendarConnectDto,
  GoogleCalendarStatusDto,
  StartGoogleCalendarConnectDto,
} from '../dtos/google-calendar.dto';

/**
 * The caller's own Google Calendar connection in the active chapter (#3322,
 * step 2; `spec/behavior/events.md` § Google Calendar).
 *
 * Connecting takes the subscription link's gate (`CalendarFeedController`):
 * `members:view`, which every read of events and tasks needs, since the sync
 * writes nothing the member couldn't read in the app. Reading the connection
 * and Disconnect need only membership, so a member whose role loses the
 * permission can still see and end their own connection (one who leaves the
 * chapter is disconnected by the sync). `@FreeTier()`, as the
 * link is: the member's own state, not a paid feature. Disconnect is
 * `@SubscriptionExempt()` as member safety: the sync has no subscription
 * check, so a member must be able to stop it while the chapter is locked.
 * Google's redirect lands on `GoogleCalendarCallbackController`, unguarded.
 */
@ApiTags('Google Calendar')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard)
@FreeTier()
@Controller('google-calendar')
export class GoogleCalendarController {
  constructor(private readonly google: GoogleCalendarService) {}

  @Get()
  @ApiOperation({
    summary:
      "Whether Google Calendar is offered here, and the caller's connection.",
  })
  @ApiOkResponse({ type: GoogleCalendarStatusDto })
  status(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<GoogleCalendarStatusDto> {
    return this.google.status(chapterId, userId);
  }

  @Post('connect')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Start connecting Google Calendar: a single-use sign-in, and Google’s consent page to send the member to.',
  })
  @ApiOkResponse({ type: GoogleCalendarConnectDto })
  connect(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: StartGoogleCalendarConnectDto,
  ): Promise<GoogleCalendarConnectDto> {
    return this.google.connect(
      chapterId,
      userId,
      dto.client,
      dto.return_url ?? null,
    );
  }

  @Post('confirm')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Finish connecting with the code Google returned. Only the member who started the sign-in, in the same chapter, can finish it.',
  })
  @ApiOkResponse({ type: GoogleCalendarStatusDto })
  confirm(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ConfirmGoogleCalendarConnectDto,
  ): Promise<GoogleCalendarStatusDto> {
    return this.google.confirm(chapterId, userId, dto.state, dto.code);
  }

  @Delete()
  @SubscriptionExempt()
  @HttpCode(204)
  @ApiOperation({
    summary:
      "Disconnect Google Calendar: removes Frapp's calendar from the member's Google account and revokes Frapp's access.",
  })
  @ApiNoContentResponse()
  async disconnect(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    await this.google.disconnect(chapterId, userId);
  }
}
