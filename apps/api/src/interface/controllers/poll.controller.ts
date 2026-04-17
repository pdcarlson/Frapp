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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PollService } from '../../application/services/poll.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '../../domain/constants/permissions';
import { CreatePollDto, ListPollsQueryDto, VoteDto } from '../dtos/poll.dto';

@ApiTags('Polls')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@Controller()
export class PollController {
  constructor(private readonly pollService: PollService) {}

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
  @ApiOperation({ summary: 'Cast vote on a poll' })
  async vote(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: VoteDto,
  ) {
    const indexes = Array.isArray(dto.option_indexes)
      ? dto.option_indexes
      : [dto.option_indexes];
    await this.pollService.vote(messageId, userId, chapterId, indexes);
    return { success: true };
  }

  @Delete('polls/:messageId/vote')
  @ApiOperation({ summary: 'Remove vote from a poll' })
  async removeVote(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.pollService.removeVote(messageId, userId, chapterId);
    return { success: true };
  }

  @Get('polls')
  @ApiOperation({
    summary: 'List polls across the chapter',
    description:
      "Chapter-wide poll list. Supports channel filter, active=true|false filter, and limit. Each entry includes aggregate results plus the caller's own selections.",
  })
  async listPolls(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query() query: ListPollsQueryDto,
  ) {
    return this.pollService.listPolls(chapterId, {
      channelId: query.channel_id,
      active: query.active === undefined ? undefined : query.active === 'true',
      limit: query.limit,
      userId,
    });
  }

  @Get('polls/:messageId')
  @ApiOperation({ summary: 'Get poll with results' })
  async getPoll(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.pollService.getPoll(messageId, chapterId, userId);
  }
}
