import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ChatService } from '../../application/services/chat.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
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
  RequestChatUploadUrlDto,
} from '../dtos/chat.dto';
import type { ChannelType } from '../../domain/entities/chat.entity';

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard)
@Controller('channels')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ── Channels ─────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List chapter channels' })
  async listChannels(@CurrentChapterId() chapterId: string) {
    return this.chatService.getChannels(chapterId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get channel by ID' })
  async getChannel(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
  ) {
    return this.chatService.getChannel(id, chapterId);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_CREATE)
  @ApiOperation({ summary: 'Create a channel' })
  async createChannel(
    @CurrentChapterId() chapterId: string,
    @Body() dto: CreateChannelDto,
  ) {
    return this.chatService.createChannel({
      chapter_id: chapterId,
      name: dto.name,
      description: dto.description,
      type: dto.type as ChannelType,
      required_permissions: dto.required_permissions,
      category_id: dto.category_id,
      is_read_only: dto.is_read_only,
    });
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
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
  @UseGuards(PermissionsGuard)
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
  @UseGuards(PermissionsGuard)
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
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Update a channel category' })
  async updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.chatService.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Delete a channel category' })
  async deleteCategory(@Param('id') id: string) {
    await this.chatService.deleteCategory(id);
    return { success: true };
  }

  // ── Messages ─────────────────────────────────────────────────────────

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get channel message history' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({
    name: 'before',
    required: false,
    description: 'Cursor for pagination (ISO timestamp)',
  })
  async getMessages(
    @Param('id') channelId: string,
    @Query('limit') limit?: number,
    @Query('before') before?: string,
  ) {
    return this.chatService.getMessages(channelId, { limit, before });
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Send a message' })
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
      reply_to_id: dto.reply_to_id,
      metadata: dto.metadata,
    });
  }

  @Patch('messages/:messageId')
  @ApiOperation({ summary: 'Edit a message (own only)' })
  async editMessage(
    @Param('messageId') messageId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.chatService.editMessage(messageId, userId, dto.content);
  }

  @Delete('messages/:messageId')
  @ApiOperation({ summary: 'Delete a message (soft delete)' })
  async deleteMessage(
    @Param('messageId') messageId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatService.deleteMessage(messageId, userId, false);
  }

  // ── Pins ─────────────────────────────────────────────────────────────

  @Get(':id/pins')
  @ApiOperation({ summary: 'Get pinned messages in a channel' })
  async getPinnedMessages(@Param('id') channelId: string) {
    return this.chatService.getPinnedMessages(channelId);
  }

  @Post('messages/:messageId/pin')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Pin a message' })
  async pinMessage(@Param('messageId') messageId: string) {
    return this.chatService.pinMessage(messageId);
  }

  @Delete('messages/:messageId/pin')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Unpin a message' })
  async unpinMessage(@Param('messageId') messageId: string) {
    return this.chatService.unpinMessage(messageId);
  }

  // ── Reactions ────────────────────────────────────────────────────────

  @Post('messages/:messageId/reactions')
  @ApiOperation({ summary: 'Toggle reaction (add/remove)' })
  async toggleReaction(
    @Param('messageId') messageId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ReactionDto,
  ) {
    return this.chatService.toggleReaction(messageId, userId, dto.emoji);
  }

  @Get('messages/:messageId/reactions')
  @ApiOperation({ summary: 'Get reactions for a message' })
  async getReactions(@Param('messageId') messageId: string) {
    return this.chatService.getReactions(messageId);
  }

  // ── File Upload ────────────────────────────────────────────────────

  @Post(':id/upload-url')
  @ApiOperation({
    summary: 'Generate a signed upload URL for a chat file attachment',
  })
  async requestUploadUrl(
    @Param('id') channelId: string,
    @CurrentChapterId() chapterId: string,
    @Body() dto: RequestChatUploadUrlDto,
  ) {
    return this.chatService.requestChatUploadUrl(
      channelId,
      chapterId,
      dto.filename,
      dto.content_type,
    );
  }

  // ── Read Receipts ────────────────────────────────────────────────────

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark channel as read' })
  async markRead(
    @Param('id') channelId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatService.markChannelRead(channelId, userId);
  }
}
