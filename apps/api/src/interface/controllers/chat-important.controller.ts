import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ChatImportantService } from '../../application/services/chat-important.service';
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
import {
  ImportantMessagesDto,
  MarkImportantSeenDto,
} from '../dtos/chat-important.dto';

/**
 * The "1 important message" strip (#4186): which Important messages in a
 * channel the caller hasn't seen, and marking them seen.
 * spec/behavior/chat/README.md § Message flags.
 *
 * Every route is the caller's own state in a channel they can read, so the
 * class-level `members:view` is the gate and `assertChannelAccess` in the
 * service is the authorization that matters, as for the read receipt. The
 * writes answer 200 with the strip's new state, so a client sets its cache
 * from the answer rather than reading again.
 *
 * Its own controller on `channels`: every route has two or three segments
 * with a literal after `:id`, so none can collide with `ChatController`'s.
 */
@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('channels')
export class ChatImportantController {
  constructor(private readonly important: ChatImportantService) {}

  @Get(':id/important')
  @ApiOperation({
    summary:
      'Unseen Important messages in a channel, for the "1 important message" strip',
  })
  @ApiOkResponse({ type: ImportantMessagesDto })
  async listUnseen(
    @Param('id', ParseUUIDPipe) channelId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.important.listUnseen(channelId, chapterId, userId);
  }

  @Post(':id/important/seen')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark Important messages seen (jumped to or scrolled past)',
  })
  @ApiOkResponse({ type: ImportantMessagesDto })
  async markSeen(
    @Param('id', ParseUUIDPipe) channelId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: MarkImportantSeenDto,
  ) {
    return this.important.markSeen(
      channelId,
      chapterId,
      userId,
      dto.message_ids,
    );
  }

  @Post(':id/important/dismiss')
  @HttpCode(200)
  @ApiOperation({
    summary: "Dismiss a channel's Important strip: mark every one seen",
  })
  @ApiOkResponse({ type: ImportantMessagesDto })
  async dismissAll(
    @Param('id', ParseUUIDPipe) channelId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.important.dismissAll(channelId, chapterId, userId);
  }
}
