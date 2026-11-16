import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PollService } from '../../application/services/poll.service';
import { RbacService } from '../../application/services/rbac.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { RequireModule } from '../decorators/module.decorator';
import {
  FeatureEvent,
  type FeatureEventInput,
} from '../decorators/feature-event.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import { CreatePollDto, ListPollsQueryDto, VoteDto } from '../dtos/poll.dto';
import { ChatMessageDto } from '../dtos/chat.dto';
import { parseBooleanQueryParam } from '../utils/query-boolean';

@ApiTags('Polls')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@RequireModule('polls')
@Controller()
export class PollController {
  constructor(
    private readonly pollService: PollService,
    private readonly rbacService: RbacService,
  ) {}

  @Post('channels/:channelId/polls')
  @RequirePermissions(SystemPermissions.POLLS_CREATE)
  @ApiOperation({ summary: 'Create a poll in a channel' })
  async createPoll(
    @Param('channelId') channelId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreatePollDto,
  ) {
    return this.pollService.createPoll({
      channelId,
      chapterId,
      senderId: userId,
      question: dto.question,
      options: dto.options,
      expiresAt: dto.expires_at,
      choiceMode: dto.choice_mode,
    });
  }

  @Post('polls/:messageId/vote')
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  @ApiOperation({ summary: 'Cast vote on a poll' })
  // No client calls this since web's `/polls` page and its hooks were retired
  // (#3871); the route goes in #3887. The service
  // replaces any earlier vote without saying whether there was one, so there
  // is no `is_revote`, and a repeat counts again. A multi-choice vote with
  // nothing selected clears the vote, which is not a vote cast.
  @FeatureEvent('poll-voted', ({ body }: FeatureEventInput<VoteDto>) => {
    const selectedCount = Array.isArray(body.option_indexes)
      ? body.option_indexes.length
      : 0;
    if (selectedCount === 0) return null;
    return { surface: 'page', selected_count: selectedCount };
  })
  async vote(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: VoteDto,
  ) {
    await this.pollService.vote(
      messageId,
      userId,
      chapterId,
      dto.option_indexes,
    );
    return { success: true };
  }

  @Delete('polls/:messageId/vote')
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  @ApiOperation({ summary: 'Remove vote from a poll' })
  async removeVote(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.pollService.removeVote(messageId, userId, chapterId);
    return { success: true };
  }

  @Post('polls/:messageId/close')
  // Any member reaches it, as with voting; the service decides. Its creator
  // may close a poll without `polls:create` (posting a card never needed it,
  // #3007), and a `channels:manage` holder may close anyone's (#4046).
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  @ApiOperation({
    summary:
      'Manually close a poll early (its creator, or channels:manage): a REST poll or a chat-card poll',
  })
  // The closed row, so a client can draw the close before its Realtime echo
  // (`closePoll` in `@repo/chat-core/chat-client`, #3794).
  @ApiCreatedResponse({ type: ChatMessageDto })
  async close(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    // Resolved here rather than by `@RequirePermissions`, as chat's
    // `setChannelDisplayLock` does, since the creator needs no permission.
    // Lazy: the service asks only when the caller isn't the poll's creator.
    return this.pollService.close(messageId, userId, chapterId, () =>
      this.rbacService.memberHasAnyPermission(chapterId, userId, [
        SystemPermissions.CHANNELS_MANAGE,
      ]),
    );
  }

  @Get('polls')
  @RequirePermissions(SystemPermissions.POLLS_VIEW_ALL)
  @ApiOperation({
    summary: 'List polls across the chapter',
    description:
      "Chapter-wide poll list for dashboards (requires polls:view_all; not part of the default Everyone role). Supports channel filter, active=true|false filter, and limit. Each entry includes aggregate results plus the caller's own selections.",
  })
  async listPolls(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query() query: ListPollsQueryDto,
  ) {
    return this.pollService.listPolls(chapterId, {
      channelId: query.channel_id,
      active: parseBooleanQueryParam(query.active),
      limit: query.limit,
      userId,
    });
  }

  @Get('polls/:messageId')
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  @ApiOperation({ summary: 'Get poll with results' })
  async getPoll(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.pollService.getPoll(messageId, chapterId, userId);
  }
}
