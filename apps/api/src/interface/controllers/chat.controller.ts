import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ChatService } from '../../application/services/chat.service';
import { RbacService } from '../../application/services/rbac.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { FreeTier } from '../decorators/subscription.decorator';
import { ThrottleFanOutWrite } from '../decorators/throttle-profiles.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '../../domain/constants/permissions';
import {
  CreateChannelDto,
  UpdateChannelDto,
  CreateDmDto,
  CreateGroupDmDto,
  CreateCategoryDto,
  UpdateCategoryDto,
  SendMessageDto,
  EditMessageDto,
  ReactionDto,
  ChatMessageActionDto,
  RequestChatUploadUrlDto,
  ChannelUnreadCountDto,
  SetChannelNotificationLevelDto,
  ChannelNotificationPreferenceDto,
} from '../dtos/chat.dto';
import type { ChannelType } from '../../domain/entities/chat.entity';

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('channels')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly rbacService: RbacService,
  ) {}

  // ── Channels ─────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List chapter channels' })
  async listChannels(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatService.getChannels(chapterId, userId);
  }

  // MUST stay above `@Get(':id')`. Nest matches routes in declaration order and
  // a single-segment `:id` would otherwise swallow this path, resolving it as
  // `getChannel('unread')` and answering 404 for a route that exists.
  // Enforced by `test/route-declaration-order.e2e-spec.ts` (#990).
  @Get('unread')
  @ApiOperation({
    summary: 'Unread and mention counts for every channel the caller can read',
  })
  @ApiOkResponse({ type: ChannelUnreadCountDto, isArray: true })
  async getUnreadCounts(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ChannelUnreadCountDto[]> {
    return this.chatService.getUnreadCounts(chapterId, userId);
  }

  // MUST stay above `@Get(':id')`, for the same reason as `unread` directly
  // above — `:id` is a single segment and would resolve this as
  // `getChannel('notification-preferences')`.
  // Enforced by `test/route-declaration-order.e2e-spec.ts` (#990).
  @Get('notification-preferences')
  @ApiOperation({
    summary: "The caller's own per-channel notification levels",
  })
  @ApiOkResponse({ type: ChannelNotificationPreferenceDto, isArray: true })
  async getChannelNotificationPreferences(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ChannelNotificationPreferenceDto[]> {
    return this.chatService.getChannelNotificationPreferences(
      chapterId,
      userId,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get channel by ID' })
  async getChannel(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatService.getChannel(id, chapterId, userId);
  }

  @Post()
  @RequirePermissions(SystemPermissions.CHANNELS_CREATE)
  @ApiOperation({ summary: 'Create a channel' })
  async createChannel(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateChannelDto,
  ) {
    return this.chatService.createChannel(
      {
        chapter_id: chapterId,
        name: dto.name,
        description: dto.description,
        type: dto.type as ChannelType,
        required_permissions: dto.required_permissions,
        category_id: dto.category_id,
        is_read_only: dto.is_read_only,
      },
      userId,
    );
  }

  @Patch(':id')
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Update a channel' })
  async updateChannel(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.chatService.updateChannel(id, chapterId, dto);
  }

  @Delete(':id')
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Delete a channel' })
  async deleteChannel(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
  ) {
    await this.chatService.deleteChannel(id, chapterId);
    return { success: true };
  }

  @Post('dm')
  @ApiOperation({ summary: 'Get or create a 1-on-1 DM channel' })
  async getOrCreateDm(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateDmDto,
  ) {
    return this.chatService.getOrCreateDm({
      chapter_id: chapterId,
      member_ids: [userId, dto.member_id],
    });
  }

  @Post('group-dm')
  @ApiOperation({ summary: 'Create a group DM channel' })
  async createGroupDm(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateGroupDmDto,
  ) {
    const memberIds = Array.from(new Set([userId, ...dto.member_ids]));
    return this.chatService.createGroupDm(chapterId, memberIds, dto.name);
  }

  // ── Categories ───────────────────────────────────────────────────────

  @Get('categories/list')
  @ApiOperation({ summary: 'List channel categories' })
  async listCategories(@CurrentChapterId() chapterId: string) {
    return this.chatService.getCategories(chapterId);
  }

  @Post('categories')
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Create a channel category' })
  async createCategory(
    @CurrentChapterId() chapterId: string,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.chatService.createCategory({
      chapter_id: chapterId,
      name: dto.name,
      display_order: dto.display_order,
    });
  }

  @Patch('categories/:id')
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Update a channel category' })
  async updateCategory(
    @Param('id') id: string,
    @CurrentChapterId() chapterId: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.chatService.updateCategory(id, chapterId, dto);
  }

  @Delete('categories/:id')
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Delete a channel category' })
  async deleteCategory(
    @Param('id') id: string,
    @CurrentChapterId() chapterId: string,
  ) {
    await this.chatService.deleteCategory(id, chapterId);
    return { success: true };
  }

  // ── Messages ─────────────────────────────────────────────────────────

  @Get(':id/messages')
  @ApiOperation({
    summary: 'Get channel message history (supports since= reconnect replay)',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({
    name: 'before',
    required: false,
    description: 'Cursor for pagination (ISO timestamp)',
  })
  @ApiQuery({
    name: 'since',
    required: false,
    description:
      'Message UUID — returns messages created after this message (reconnect replay)',
  })
  async getMessages(
    @Param('id') channelId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: number,
    @Query('before') before?: string,
    @Query('since') since?: string,
  ) {
    if (since !== undefined) {
      try {
        await new ParseUUIDPipe().transform(since, {
          type: 'query',
          data: 'since',
        });
      } catch {
        throw new BadRequestException('since must be a valid UUID');
      }
    }
    return this.chatService.getMessages(channelId, chapterId, userId, {
      limit,
      before,
      since,
    });
  }

  @Post(':id/messages')
  @ApiOperation({
    summary: 'Send a message (hot path; idempotent on client_message_id)',
  })
  async sendMessage(
    @Param('id') channelId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage({
      chapter_id: chapterId,
      channel_id: channelId,
      sender_id: userId,
      content: dto.content,
      client_message_id: dto.client_message_id,
      kind: dto.kind,
      payload: dto.payload,
      reply_to_id: dto.reply_to_id,
      metadata: dto.metadata,
      attachments: dto.attachments,
    });
  }

  /**
   * Attachments on one message, each with a signed download URL.
   *
   * A route of its own rather than a field on the message read: the URLs expire,
   * so they have to be minted when they are about to be used, and the clients'
   * message caches are fed partly by Realtime rows, which cannot carry a join at
   * all. `metadata.attachment_count` on the message row is what tells a client
   * this is worth calling.
   */
  @Get(':id/messages/:messageId/attachments')
  @ApiOperation({
    summary: 'Attachments on a message, with signed download URLs',
  })
  async listMessageAttachments(
    @Param('id') channelId: string,
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatService.listMessageAttachments(
      channelId,
      chapterId,
      userId,
      messageId,
    );
  }

  @Patch('messages/:messageId')
  @ApiOperation({ summary: 'Edit a message (own only)' })
  async editMessage(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.chatService.editMessage(
      messageId,
      chapterId,
      userId,
      dto.content,
    );
  }

  @Delete('messages/:messageId')
  @ApiOperation({
    summary:
      'Delete a message (soft delete; own message, or any in an accessible channel with channels:manage)',
  })
  async deleteMessage(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    // spec/behavior/chat/README.md lets a `channels:manage` holder moderate
    // other members' messages. This route previously hardcoded `false`, so that
    // path could never fire. Resolving the permission here (rather than via
    // @RequirePermissions) keeps the endpoint open to authors deleting their
    // own messages; the service still re-checks channel access in the active
    // chapter before honouring either path.
    const hasManagePermission = await this.rbacService.memberHasAnyPermission(
      chapterId,
      userId,
      [SystemPermissions.CHANNELS_MANAGE],
    );

    return this.chatService.deleteMessage(
      messageId,
      chapterId,
      userId,
      hasManagePermission,
    );
  }

  // ── Pins ─────────────────────────────────────────────────────────────

  @Get(':id/pins')
  @ApiOperation({ summary: 'Get pinned messages in a channel' })
  async getPinnedMessages(
    @Param('id') channelId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatService.getPinnedMessages(channelId, chapterId, userId);
  }

  @Post('messages/:messageId/pin')
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Pin a message' })
  async pinMessage(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatService.pinMessage(messageId, chapterId, userId);
  }

  @Delete('messages/:messageId/pin')
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Unpin a message' })
  async unpinMessage(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatService.unpinMessage(messageId, chapterId, userId);
  }

  // ── Actions (chat_message_actions hot-path: reactions / votes / RSVPs) ──

  @Post('messages/:messageId/actions')
  @ApiOperation({
    summary:
      'Record a reaction / vote / card action (hot path; atomic dedup; vote UPSERTS)',
  })
  async recordMessageAction(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ChatMessageActionDto,
  ) {
    return this.chatService.recordMessageAction(messageId, chapterId, userId, {
      action_type: dto.action_type,
      payload: dto.payload,
    });
  }

  // ── Reactions ────────────────────────────────────────────────────────

  @Post('messages/:messageId/reactions')
  @ApiOperation({ summary: 'Toggle reaction (add/remove)' })
  async toggleReaction(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ReactionDto,
  ) {
    return this.chatService.toggleReaction(
      messageId,
      chapterId,
      userId,
      dto.emoji,
    );
  }

  @Get('messages/:messageId/reactions')
  @ApiOperation({ summary: 'Get reactions for a message' })
  async getReactions(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatService.getReactions(messageId, chapterId, userId);
  }

  // ── File Upload ────────────────────────────────────────────────────

  @Post(':id/upload-url')
  @ThrottleFanOutWrite()
  @ApiOperation({
    summary: 'Generate a signed upload URL for a chat file attachment',
  })
  async requestUploadUrl(
    @Param('id') channelId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: RequestChatUploadUrlDto,
  ) {
    return this.chatService.requestChatUploadUrl(
      channelId,
      chapterId,
      userId,
      dto.filename,
      dto.content_type,
    );
  }

  // ── Read Receipts ────────────────────────────────────────────────────

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark channel as read' })
  async markRead(
    @Param('id') channelId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatService.markChannelRead(channelId, chapterId, userId);
  }

  // ── Per-channel notification level (mute) ────────────────────────────

  /**
   * Two segments, so unlike the GET above this one cannot be swallowed by
   * `@Patch(':id')` — but it is kept beside the read-receipt route, which is
   * its closest sibling: both are per-user writes scoped to one channel.
   *
   * No extra `@RequirePermissions`: the class-level `MEMBERS_VIEW` is the right
   * gate, because a member is changing *their own* notification settings for a
   * channel they can already read. The authorization that matters is
   * `assertChannelAccess` in the service, not a chapter-wide permission.
   */
  @Put(':id/notification-preference')
  @ApiOperation({
    summary: "Set the caller's notification level for a channel",
  })
  @ApiOkResponse({ type: ChannelNotificationPreferenceDto })
  async setChannelNotificationLevel(
    @Param('id', ParseUUIDPipe) channelId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SetChannelNotificationLevelDto,
  ): Promise<ChannelNotificationPreferenceDto> {
    return this.chatService.setChannelNotificationLevel(
      channelId,
      chapterId,
      userId,
      dto.level,
    );
  }
}
