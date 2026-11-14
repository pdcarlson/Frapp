import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ChatScheduledMessageService } from '../../application/services/chat-scheduled-message.service';
import type { ChatScheduledMessage } from '#domain/entities/chat-scheduled-message.entity';
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
import { ChatMessageDto } from '../dtos/chat.dto';
import {
  CreateScheduledMessageDto,
  ListScheduledMessagesQueryDto,
  ScheduledMessageDto,
  UpdateScheduledMessageDto,
} from '../dtos/chat-scheduled-message.dto';

/**
 * The caller's own scheduled chat messages (#4956;
 * `spec/behavior/chat/README.md` § Scheduled messages).
 *
 * A root of its own, like bookmarks, so nothing here depends on route order
 * under `@Controller('channels')`. The guard chain matches `ChatController`,
 * `@FreeTier()` included. Every route reads or changes only the caller's own
 * rows, and none takes a user id; whether they may post in the channel is
 * checked when they schedule and again when it sends.
 */
@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('scheduled-messages')
export class ChatScheduledMessageController {
  constructor(private readonly scheduled: ChatScheduledMessageService) {}

  @Get()
  @ApiOperation({
    summary:
      "List the caller's scheduled messages in this chapter (pending and failed), soonest first",
  })
  @ApiOkResponse({ type: ScheduledMessageDto, isArray: true })
  async list(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query() query: ListScheduledMessagesQueryDto,
  ): Promise<ScheduledMessageDto[]> {
    const rows = await this.scheduled.list(chapterId, userId, query.channel_id);
    return rows.map(toView);
  }

  @Post()
  @ApiOperation({ summary: 'Schedule a text message to post later' })
  @ApiCreatedResponse({ type: ScheduledMessageDto })
  async create(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateScheduledMessageDto,
  ): Promise<ScheduledMessageDto> {
    return toView(await this.scheduled.schedule(chapterId, userId, dto));
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Change a scheduled message’s text or time (a failed one goes back in line)',
  })
  @ApiOkResponse({ type: ScheduledMessageDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateScheduledMessageDto,
  ): Promise<ScheduledMessageDto> {
    return toView(await this.scheduled.update(chapterId, userId, id, dto));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a scheduled message before it posts' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    await this.scheduled.remove(chapterId, userId, id);
  }

  @Post(':id/send')
  @ApiOperation({ summary: 'Post a scheduled message now' })
  @ApiCreatedResponse({ type: ChatMessageDto })
  async sendNow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.scheduled.sendNow(chapterId, userId, id);
  }
}

/** What leaves the API: no author, chapter, attempts or lease. */
function toView(row: ChatScheduledMessage): ScheduledMessageDto {
  return {
    id: row.id,
    channel_id: row.channel_id,
    content: row.content,
    mention_picks: row.mention_picks,
    send_at: row.send_at,
    status: row.status,
    failure_reason: row.failure_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
