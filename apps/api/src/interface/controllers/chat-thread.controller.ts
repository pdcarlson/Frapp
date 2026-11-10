import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ChatThreadService } from '../../application/services/chat-thread.service';
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
  ChatMessageDto,
  ChatThreadDto,
  FollowedThreadDto,
  GetChannelMessagesQueryDto,
  SetThreadFollowDto,
  ThreadFollowStateDto,
  ThreadReadDto,
} from '../dtos/chat.dto';

/**
 * Message threads (#3785): a side conversation off one message. A reply is
 * posted through `POST /v1/channels/:id/messages` with `thread_root_id`; these
 * routes read a thread and keep the caller's follow and read cursor.
 *
 * Same guard chain and permission as `ChatController`, whose routes these sit
 * beside. Every route authorizes the channel, then resolves the root inside it.
 */
@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('channels')
export class ChatThreadController {
  constructor(private readonly threads: ChatThreadService) {}

  // Two literal segments, so this never collides with `:id/threads/:rootId`.
  @Get(':id/threads/followed')
  @ApiOperation({
    summary:
      'The caller’s followed and muted threads in a channel, with new-reply counts',
  })
  @ApiOkResponse({ type: FollowedThreadDto, isArray: true })
  getFollowedThreads(
    @Param('id', ParseUUIDPipe) channelId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.threads.getFollowedThreads(channelId, chapterId, userId);
  }

  @Get(':id/threads/:rootId')
  @ApiOperation({
    summary: 'A thread’s parent message and the caller’s follow',
  })
  @ApiOkResponse({ type: ChatThreadDto })
  getThread(
    @Param('id', ParseUUIDPipe) channelId: string,
    @Param('rootId', ParseUUIDPipe) rootId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.threads.getThread(channelId, rootId, chapterId, userId);
  }

  @Get(':id/threads/:rootId/messages')
  @ApiOperation({
    summary:
      'A thread’s replies, newest first, paged like the channel timeline (before= and since=)',
  })
  @ApiOkResponse({ type: ChatMessageDto, isArray: true })
  getReplies(
    @Param('id', ParseUUIDPipe) channelId: string,
    @Param('rootId', ParseUUIDPipe) rootId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query() query: GetChannelMessagesQueryDto,
  ) {
    return this.threads.getReplies(channelId, rootId, chapterId, userId, {
      limit: query.limit,
      before: query.before,
      since: query.since,
    });
  }

  @Put(':id/threads/:rootId/follow')
  @ApiOperation({ summary: 'Follow, mute or unfollow a thread' })
  @ApiOkResponse({ type: ThreadFollowStateDto })
  setFollow(
    @Param('id', ParseUUIDPipe) channelId: string,
    @Param('rootId', ParseUUIDPipe) rootId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SetThreadFollowDto,
  ) {
    return this.threads.setFollow(
      channelId,
      rootId,
      chapterId,
      userId,
      dto.state,
    );
  }

  @Post(':id/threads/:rootId/read')
  // Moves a cursor; it creates nothing a client would address (#3085).
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark a thread read through now' })
  @ApiOkResponse({ type: ThreadReadDto })
  markRead(
    @Param('id', ParseUUIDPipe) channelId: string,
    @Param('rootId', ParseUUIDPipe) rootId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.threads.markRead(channelId, rootId, chapterId, userId);
  }
}
