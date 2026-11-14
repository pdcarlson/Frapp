import {
  Body,
  Controller,
  Delete,
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
import { ChatReminderService } from '../../application/services/chat-reminder.service';
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
import { ChatReminderRefDto, SetChatReminderDto } from '../dtos/activity.dto';

/**
 * "Remind me about this" on a chat message (#4957). The list is a section of
 * `GET /v1/activity`; these routes set, move and clear the caller's own.
 *
 * Guard chain matches `ChatBookmarkController`, `@FreeTier()` included: a
 * reminder is part of chat, which a chapter in its billing grace window
 * keeps. No route takes a user id; the owner is always the caller.
 */
@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('reminders')
export class ChatReminderController {
  constructor(private readonly reminderService: ChatReminderService) {}

  @Put('messages/:messageId')
  @ApiOperation({
    summary:
      'Remind the caller about a message at a time, or move the reminder',
    description:
      'One reminder per member per message: setting it again moves it, and one already sent fires again at the new time (Activity’s snooze). Needs read access to the message’s channel.',
  })
  @ApiOkResponse({ type: ChatReminderRefDto })
  async setReminder(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: SetChatReminderDto,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ChatReminderRefDto> {
    return this.reminderService.setReminder(
      messageId,
      chapterId,
      userId,
      new Date(dto.remind_at),
    );
  }

  @Delete('messages/:messageId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Clear the caller’s reminder on a message (idempotent)',
    description:
      'Done on Activity, or cancel. Works after the caller lost the channel, and answers 204 whether or not there was one.',
  })
  @ApiNoContentResponse()
  async clearReminder(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    await this.reminderService.clearReminder(messageId, chapterId, userId);
  }
}
