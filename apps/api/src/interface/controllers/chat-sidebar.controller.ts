import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ChatSidebarService } from '../../application/services/chat-sidebar.service';
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
import { ChatSidebarDto, UpdateChatSidebarDto } from '../dtos/chat-sidebar.dto';

/**
 * A member's own chat sidebar arrangement (#2877): pins, folded sections and
 * the two filters. Rule: `spec/behavior/chat/README.md` § Sidebar arrangement.
 *
 * **Its own root, like `/v1/bookmarks`,** rather than more routes on
 * `@Controller('channels')`, where a single-segment `GET /channels/sidebar`
 * would have to be declared above `@Get(':id')` or be swallowed by it (#990).
 *
 * Guard chain matches `ChatController` exactly, `@FreeTier()` included: the
 * sidebar is part of chat, which a chapter in its grace window keeps.
 * `MEMBERS_VIEW` is chat's own floor. No route takes a user id, so a member
 * only ever reads or changes their own arrangement.
 *
 * Every route answers with the whole arrangement, so a client can replace its
 * cached copy with the response instead of refetching.
 */
@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('chat-sidebar')
export class ChatSidebarController {
  constructor(private readonly sidebarService: ChatSidebarService) {}

  @Get()
  @ApiOperation({ summary: "The caller's own chat sidebar arrangement" })
  @ApiOkResponse({ type: ChatSidebarDto })
  async getSidebar(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ChatSidebarDto> {
    return this.sidebarService.getSidebar(chapterId, userId);
  }

  @Patch()
  @ApiOperation({
    summary:
      'Switch the sidebar filters. A filter left out keeps its stored value.',
  })
  @ApiOkResponse({ type: ChatSidebarDto })
  async updateSidebar(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateChatSidebarDto,
  ): Promise<ChatSidebarDto> {
    return this.sidebarService.updateFilters(chapterId, userId, dto);
  }

  @Put('collapsed/:sectionKey')
  @ApiOperation({ summary: 'Fold a sidebar section (idempotent)' })
  @ApiOkResponse({ type: ChatSidebarDto })
  async collapseSection(
    @Param('sectionKey') sectionKey: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ChatSidebarDto> {
    return this.sidebarService.setSectionCollapsed(
      chapterId,
      userId,
      sectionKey,
      true,
    );
  }

  @Delete('collapsed/:sectionKey')
  @ApiOperation({ summary: 'Unfold a sidebar section (idempotent)' })
  @ApiOkResponse({ type: ChatSidebarDto })
  async expandSection(
    @Param('sectionKey') sectionKey: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ChatSidebarDto> {
    return this.sidebarService.setSectionCollapsed(
      chapterId,
      userId,
      sectionKey,
      false,
    );
  }

  @Put('pins/:channelId')
  @ApiOperation({
    summary: 'Pin a channel to the top of your sidebar (idempotent)',
  })
  @ApiOkResponse({ type: ChatSidebarDto })
  async pinChannel(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ChatSidebarDto> {
    return this.sidebarService.pin(chapterId, userId, channelId);
  }

  @Delete('pins/:channelId')
  @ApiOperation({ summary: 'Unpin a channel from your sidebar (idempotent)' })
  @ApiOkResponse({ type: ChatSidebarDto })
  async unpinChannel(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ChatSidebarDto> {
    return this.sidebarService.unpin(chapterId, userId, channelId);
  }
}
