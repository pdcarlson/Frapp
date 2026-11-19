import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { MeetingMinutesRequestService } from '../../application/services/meeting-minutes-request.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import { RequireModule } from '../decorators/module.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import {
  MinutesRequestQueryDto,
  MinutesRequestSentDto,
  MinutesRequestStateDto,
} from '../dtos/meeting-minutes-request.dto';

/**
 * A member asks for minutes that haven't been posted (#5471,
 * `spec/behavior/meetings.md` § Asking for minutes).
 *
 * `members:view`, the floor every events and minutes route has: no meetings
 * permission, since any member the meeting's event shows itself to may ask.
 * The service decides the rest, and answers anyone the event leaves out with
 * the 404 a missing id gets.
 */
@ApiTags('Meetings')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@RequireModule('meetings')
@Controller()
export class MeetingMinutesRequestController {
  constructor(private readonly requests: MeetingMinutesRequestService) {}

  @Get('minutes-requests')
  @ApiOperation({
    summary:
      'The event’s unposted minutes, when the caller may ask for them (one row or none), and whether they have',
  })
  @ApiOkResponse({ type: [MinutesRequestStateDto] })
  async state(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query() query: MinutesRequestQueryDto,
  ): Promise<MinutesRequestStateDto[]> {
    return this.requests.state(chapterId, userId, query.event_id);
  }

  @Post('meetings/:id/minutes-request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Ask for unposted minutes, which reminds whoever can post them (at most once a day per meeting). Asking again changes nothing. 409 `meeting.already_posted`, 409 `meeting.not_over`, 503 `meeting.request_not_sent` (nothing recorded; ask again)',
  })
  @ApiOkResponse({ type: MinutesRequestSentDto })
  async request(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MinutesRequestSentDto> {
    return this.requests.request(chapterId, id, userId);
  }
}
