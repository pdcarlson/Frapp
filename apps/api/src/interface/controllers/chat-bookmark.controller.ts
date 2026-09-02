import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChatBookmarkService } from '../../application/services/chat-bookmark.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { FreeTier } from '../decorators/subscription.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '../../domain/constants/permissions';

/**
 * Personal message bookmarks (#462).
 *
 * **A controller of its own rather than more routes on `ChatController`.**
 * `ChatController` is `@Controller('channels')`, where a chapter-scoped
 * `GET /bookmarks` would have to be declared above `@Get(':id')` or be
 * swallowed by it — the exact hazard `test/route-declaration-order.e2e-spec.ts`
 * exists to catch (#990). Mounting bookmarks at their own root removes the
 * ordering constraint instead of adding one more route that depends on it.
 *
 * Guard chain matches `ChatController` exactly, including `@FreeTier()`:
 * bookmarks are part of the chat wedge, so a chapter in the `past_due` /
 * `incomplete` grace window keeps them. `MEMBERS_VIEW` is the same floor chat
 * itself requires — every route here is further narrowed to the caller's own
 * rows by the service, and no route accepts a user id.
 */
@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('bookmarks')
export class ChatBookmarkController {
  constructor(private readonly bookmarkService: ChatBookmarkService) {}

  @Get()
  @ApiOperation({
    summary: "List the caller's own bookmarked messages in this chapter",
  })
  async listBookmarks(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.bookmarkService.listBookmarks(chapterId, userId);
  }

  @Post('messages/:messageId')
  @ApiOperation({ summary: 'Bookmark a message (idempotent)' })
  async bookmarkMessage(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.bookmarkService.bookmarkMessage(messageId, chapterId, userId);
  }

  @Delete('messages/:messageId')
  // 204 rather than the default 200: an idempotent DELETE has no body worth
  // returning, and "was it actually bookmarked?" is deliberately not answerable
  // from the status — both cases succeed identically.
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove the caller’s bookmark (idempotent)' })
  async unbookmarkMessage(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    await this.bookmarkService.unbookmarkMessage(messageId, chapterId, userId);
  }
}
