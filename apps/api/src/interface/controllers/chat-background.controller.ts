import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CHAPTER_PROFILE_PERMISSIONS } from '@repo/validation';
import { ChatBackgroundService } from '../../application/services/chat-background.service';
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
import { SystemPermissions } from '#domain/constants/permissions';
import {
  ChapterChatBackgroundResponseDto,
  ChatBackgroundPhotoUrlDto,
  ChatBackgroundPhotoUrlResponseDto,
  ChatBackgroundResponseDto,
  SetChannelBackgroundDto,
  SetChapterChatBackgroundDto,
} from '../dtos/chat-background.dto';

/**
 * Chat backgrounds (#3973): the chapter default (whoever edits the chapter
 * profile sets it) and a channel's override (`channels:manage`). Its own
 * prefix rather than `channels/...`, so no route here can be shadowed by
 * `ChatController`'s `GET channels/:id`. Guard chain as `ChatController`,
 * `@FreeTier()` included: photo upload is not plan-gated until Paul defines
 * "Frat Max"; `ChatBackgroundService.assertPhotoBackgroundAllowed` is the hook.
 */
@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('chat-backgrounds')
export class ChatBackgroundController {
  constructor(private readonly backgrounds: ChatBackgroundService) {}

  @Get('channels/:id')
  @ApiOperation({
    summary:
      "What to draw behind a channel's messages (resolved, photo signed)",
  })
  @ApiOkResponse({ type: ChatBackgroundResponseDto })
  async getForChannel(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ChatBackgroundResponseDto> {
    return this.backgrounds.getForChannel(id, chapterId, userId);
  }

  @Put('channels/:id')
  @ThrottleFanOutWrite()
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: "Set or clear a channel's own background" })
  @ApiOkResponse({ type: ChatBackgroundResponseDto })
  async setForChannel(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetChannelBackgroundDto,
  ): Promise<ChatBackgroundResponseDto> {
    return this.backgrounds.setChannelBackground(
      id,
      chapterId,
      userId,
      dto.background ?? null,
      dto.storage_path,
    );
  }

  @Post('channels/photo-url')
  @ThrottleFanOutWrite()
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Signed upload URL for a channel background photo' })
  @ApiCreatedResponse({ type: ChatBackgroundPhotoUrlResponseDto })
  async channelPhotoUrl(
    @CurrentChapterId() chapterId: string,
    @Body() dto: ChatBackgroundPhotoUrlDto,
  ): Promise<ChatBackgroundPhotoUrlResponseDto> {
    const { signedUrl, storagePath } =
      await this.backgrounds.requestPhotoUploadUrl(
        chapterId,
        dto.filename,
        dto.content_type,
      );
    return { upload_url: signedUrl, storage_path: storagePath };
  }

  @Get('default')
  @ApiOperation({ summary: "The chapter's default chat background" })
  @ApiOkResponse({ type: ChapterChatBackgroundResponseDto })
  async getDefault(
    @CurrentChapterId() chapterId: string,
  ): Promise<ChapterChatBackgroundResponseDto> {
    return this.backgrounds.getChapterDefault(chapterId);
  }

  @Put('default')
  @ThrottleFanOutWrite()
  @RequirePermissions(...CHAPTER_PROFILE_PERMISSIONS)
  @ApiOperation({ summary: "Set the chapter's default chat background" })
  @ApiOkResponse({ type: ChapterChatBackgroundResponseDto })
  async setDefault(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SetChapterChatBackgroundDto,
  ): Promise<ChapterChatBackgroundResponseDto> {
    return this.backgrounds.setChapterDefault(
      chapterId,
      userId,
      dto.background,
      dto.storage_path,
    );
  }

  @Post('default/photo-url')
  @ThrottleFanOutWrite()
  @RequirePermissions(...CHAPTER_PROFILE_PERMISSIONS)
  @ApiOperation({ summary: 'Signed upload URL for a chapter default photo' })
  @ApiCreatedResponse({ type: ChatBackgroundPhotoUrlResponseDto })
  async defaultPhotoUrl(
    @CurrentChapterId() chapterId: string,
    @Body() dto: ChatBackgroundPhotoUrlDto,
  ): Promise<ChatBackgroundPhotoUrlResponseDto> {
    const { signedUrl, storagePath } =
      await this.backgrounds.requestPhotoUploadUrl(
        chapterId,
        dto.filename,
        dto.content_type,
      );
    return { upload_url: signedUrl, storage_path: storagePath };
  }
}
