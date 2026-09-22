import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { ChatReportService } from '../../application/services/chat-report.service';
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
  ChatReportDto,
  CreateChatReportDto,
  ListChatReportsQueryDto,
  ResolveChatReportDto,
} from '../dtos/chat-moderation.dto';

/**
 * Member-filed reports against chat messages (#2257) — App Store Guideline 1.2.
 * Contract: `spec/behavior/chat/README.md` § Report and block.
 *
 * **A controller of its own rather than more routes on `ChatController`**, for
 * the reason `ChatBookmarkController` gives: `ChatController` is
 * `@Controller('channels')`, so a root-level literal route there has to be
 * declared above `@Get(':id')` or be swallowed by it — the hazard
 * `test/route-declaration-order.e2e-spec.ts` exists to catch (#990). Mounting
 * at `chat/reports` removes the ordering constraint instead of adding one more
 * route that depends on it.
 *
 * **`@SubscriptionExempt()`, not `@FreeTier()`, and that is the deliberate
 * difference from every other chat controller.** A chapter whose card has
 * failed is hard-locked for writes once its grace window closes — `@FreeTier()`
 * does not survive that, and `canceled` it never survives at all. Reporting
 * objectionable content is not a feature a chapter buys; a member being
 * harassed in a chapter that missed a payment needs this route exactly as much
 * as one in a paid chapter, and Guideline 1.2 does not have a billing
 * exception. The marker's docblock and three prose sites used to describe the
 * exemption as billing recovery only; they now say "billing recovery and member
 * safety" because of this controller and `ChatBlockController`.
 *
 * `MEMBERS_VIEW` at the class is the same floor chat itself requires.
 * `@RequirePermissions` is a pure AND merged across class and handler, so the
 * three officer routes below require `members:view` **and** `channels:manage` —
 * which is what is wanted: the queue is a chapter-data read as well as a
 * moderation surface. `REPORT_QUEUE_PERMISSIONS` (`chat-report.service.ts`)
 * restates that union to address the new-report notification, so change the
 * two together.
 */
@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@SubscriptionExempt()
@Controller('chat/reports')
export class ChatReportController {
  constructor(private readonly reportService: ChatReportService) {}

  /**
   * Any member can report any message they can see, in a channel or a DM. The
   * service authorizes the message as a **read** through `ChannelAccessService`,
   * so the reachable set is exactly what the caller could already render.
   */
  @Post()
  @ApiOperation({
    summary: 'Report a chat message (idempotent while a report stays open)',
  })
  // Declared rather than inferred: without it the generated SDK types this
  // response `never` (the #1049 defect).
  @ApiCreatedResponse({ type: ChatReportDto })
  async fileReport(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateChatReportDto,
  ): Promise<ChatReportDto> {
    return this.reportService.fileReport(chapterId, userId, {
      message_id: dto.message_id,
      reason: dto.reason,
      details: dto.details,
    });
  }

  /**
   * The officer queue for the caller's own chapter, newest first.
   *
   * No reporter identity is served here — the repository strips
   * `reporter_user_id` on every exit, so an officer who is themselves the
   * reported member still cannot learn who filed it.
   */
  @Get()
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'List chat message reports for this chapter' })
  @ApiOkResponse({ type: ChatReportDto, isArray: true })
  async listReports(
    @CurrentChapterId() chapterId: string,
    @Query() query: ListChatReportsQueryDto,
  ): Promise<ChatReportDto[]> {
    return this.reportService.listReports(chapterId, query.status);
  }

  /**
   * Resolve a report. The update is scoped to the caller's chapter inside the
   * repository, so a `channels:manage` holder cannot close another chapter's
   * report by UUID; a miss is a 404 either way.
   */
  @Patch(':id')
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Resolve a chat message report' })
  @ApiOkResponse({ type: ChatReportDto })
  async resolveReport(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ResolveChatReportDto,
  ): Promise<ChatReportDto> {
    return this.reportService.resolveReport(id, chapterId, dto.status, userId);
  }

  /**
   * Remove the message an open report names, and mark the report `actioned`
   * (#2311, option 1). The report is the capability: this is how an officer
   * removes reported content from a DM they are not in — exactly that one
   * message, and nothing else in the thread.
   *
   * **Shaped as a command on the report, not a `DELETE` on the message**, and
   * deliberately so. The report id is the whole input: the route never accepts
   * a message id, so there is no second identifier a caller could point at a
   * sibling message, and the authority being exercised (an open report in this
   * chapter) is the resource in the URL. It sits beside the other command
   * routes in this API (`POST /v1/channels/:id/leave`,
   * `POST /v1/channels/messages/:messageId/pin`) and on this controller for
   * the reason the class docblock gives.
   *
   * `channels:manage` on top of the class floor, like the queue: the same
   * holders who can read a report can act on it. Inherits the class-level
   * `@SubscriptionExempt()` — removing reported harassment is member safety.
   *
   * 404 for a report not in the caller's chapter; 409 when the report is no
   * longer open or its message is already gone. Returns the resolved report,
   * never the message.
   */
  @Post(':id/remove-message')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({
    summary:
      'Remove the message an open report names and mark the report actioned',
  })
  @ApiOkResponse({ type: ChatReportDto })
  async removeReportedMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ChatReportDto> {
    return this.reportService.removeReportedMessage(id, chapterId, userId);
  }
}
