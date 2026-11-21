import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { MeetingDateReminderService } from '../../application/services/meeting-date-reminder.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { RequireModule } from '../decorators/module.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import {
  MeetingDateReminderDto,
  SetMeetingDateReminderDto,
} from '../dtos/meeting-date-reminder.dto';

/**
 * "Remind me" on a minutes' Coming up date (#5672 step 2,
 * `spec/behavior/meetings.md` § Reading minutes → Coming up, tracked).
 *
 * `members:view`, the floor every minutes route has: anyone the minutes show
 * themselves to may set one, and the service answers anyone else with the
 * 404 a missing id gets. No route takes a user id; the owner is always the
 * caller.
 */
@ApiTags('Meetings')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@RequireModule('meetings')
@Controller('meetings/:id/date-reminders')
export class MeetingDateReminderController {
  constructor(private readonly reminders: MeetingDateReminderService) {}

  @Get()
  @ApiOperation({
    summary:
      'The caller’s reminders still waiting on these minutes’ Coming up dates, soonest first',
  })
  @ApiOkResponse({ type: MeetingDateReminderDto, isArray: true })
  async list(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MeetingDateReminderDto[]> {
    return this.reminders.list(chapterId, userId, id);
  }

  @Put()
  @ApiOperation({
    summary:
      'Remind the caller about one of the minutes’ Coming up dates, or move that reminder',
    description:
      'One reminder per member per date, named by its day and words. 404 when the caller can’t read the minutes, or the date is no longer in them.',
  })
  @ApiOkResponse({ type: MeetingDateReminderDto })
  async set(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetMeetingDateReminderDto,
  ): Promise<MeetingDateReminderDto> {
    return this.reminders.set(chapterId, userId, id, {
      date: dto.date,
      text: dto.text,
      remindAt: new Date(dto.remind_at),
    });
  }

  @Delete(':reminderId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Cancel one of the caller’s date reminders (idempotent)',
  })
  @ApiNoContentResponse()
  async clear(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('reminderId', ParseUUIDPipe) reminderId: string,
  ): Promise<void> {
    await this.reminders.clear(chapterId, userId, id, reminderId);
  }
}
