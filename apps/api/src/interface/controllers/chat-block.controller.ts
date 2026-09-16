import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ChatBlockService } from '../../application/services/chat-block.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { SubscriptionExempt } from '../decorators/subscription.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  ChatBlockDto,
  ChatBlockListDto,
  CreateChatBlockDto,
} from '../dtos/chat-moderation.dto';

/**
 * Per-chapter member blocking (#2257) — App Store Guideline 1.2. Contract:
 * `spec/behavior/chat/README.md` § Report and block.
 *
 * **A controller of its own** for the `ChatBookmarkController` reason: a
 * root-level literal route on `@Controller('channels')` has to be declared
 * above `@Get(':id')` or be swallowed by it (#990).
 *
 * **`@SubscriptionExempt()`** — see `ChatReportController`'s docblock for the
 * argument. Being able to stop an abusive member reaching you is not something
 * a chapter's billing status may switch off.
 *
 * **Every route here is the caller's own list and only the caller's own list.**
 * No route accepts a blocker id; the owner is always `@CurrentUser('id')`, so
 * there is no parameter through which one member could read or edit another's
 * blocks. `members:view` is the same floor chat requires and no route adds to
 * it — blocking is a member control, not a moderation one.
 *
 * **The no-oracle rule binds this controller's callers too.** A block is
 * enforced by not delivering, never by refusing: nothing anywhere may answer
 * differently *because* a block exists, since a distinct error on DM creation
 * is enough to binary-search the roster and enumerate who has blocked you. The
 * two 400s on the write below are about the target (yourself, the system
 * actor), not about any existing block, and the blocked member never sees them.
 */
@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@SubscriptionExempt()
@Controller('chat/blocks')
export class ChatBlockController {
  constructor(private readonly blockService: ChatBlockService) {}

  /**
   * The caller's own blocked user ids for the active chapter.
   *
   * The client needs this even though the server masks what it serves: mobile
   * and web also receive message rows over a Supabase Realtime
   * `postgres_changes` echo, which delivers the raw row with no viewer attached
   * and therefore cannot be server-masked. A client that trusted only the
   * server's projection would render a blocked member's *live* messages in full.
   *
   * A failed read is not an empty list. There is no "unavailable" body to
   * return — the transport says that — but a client must treat a failure as
   * unavailable and hold unmaskable messages rather than render them.
   */
  @Get()
  @ApiOperation({
    summary: "List the caller's blocked members in this chapter",
  })
  @ApiOkResponse({ type: ChatBlockListDto })
  async listBlocks(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ChatBlockListDto> {
    const blocked_user_ids = await this.blockService.listBlockedUserIds(
      chapterId,
      userId,
    );
    return { blocked_user_ids };
  }

  @Post()
  @ApiOperation({ summary: 'Block a member in this chapter (idempotent)' })
  @ApiCreatedResponse({ type: ChatBlockDto })
  async blockMember(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateChatBlockDto,
  ): Promise<ChatBlockDto> {
    return this.blockService.blockMember(chapterId, userId, dto.user_id);
  }

  /**
   * Unblock. 204 with no body, and deliberately the same 204 whether or not a
   * block was there — "was I blocking them?" must not be answerable from a
   * status code any more than "is someone blocking me?" is.
   */
  @Delete(':userId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Unblock a member (idempotent)' })
  // Declared so the emitted schema says 204 rather than the 200 Nest documents
  // by default for a DELETE — the same 204 whether or not a block was there.
  @ApiNoContentResponse()
  async unblockMember(
    @Param('userId', ParseUUIDPipe) blockedUserId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    await this.blockService.unblockMember(chapterId, userId, blockedUserId);
  }
}
