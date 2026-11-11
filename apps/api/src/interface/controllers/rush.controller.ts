import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { RushService } from '../../application/services/rush.service';
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
import {
  CreateRushCandidateDto,
  CreateRushCandidateResponseDto,
  LookupRushCandidateQueryDto,
  RushCandidateViewDto,
} from '../dtos/rush-candidate.dto';
import { SystemPermissions } from '#domain/constants/permissions';

/**
 * Recruitment. Every route needs the `rush` module on, `members:view`, and
 * its own `rush:*` permission (#4070); `PermissionsGuard` requires the class
 * and handler lists together. The slash commands and the chat card call these
 * routes, so they carry the same gates.
 */
@ApiTags('Rush')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@RequireModule('rush')
@Controller('rush/candidates')
export class RushController {
  constructor(private readonly rushService: RushService) {}

  @Get()
  @RequirePermissions(SystemPermissions.RUSH_VIEW)
  @ApiOperation({ summary: 'Look up a candidate by display name' })
  @ApiOkResponse({ type: RushCandidateViewDto })
  async lookup(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query() query: LookupRushCandidateQueryDto,
  ) {
    return this.rushService.findViewByName(chapterId, userId, query.name);
  }

  @Get(':id')
  @RequirePermissions(SystemPermissions.RUSH_VIEW)
  @ApiOperation({ summary: 'Get a candidate with live vote and bid status' })
  @ApiOkResponse({ type: RushCandidateViewDto })
  async getOne(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rushService.findView(id, chapterId, userId);
  }

  @Post()
  @RequirePermissions(SystemPermissions.RUSH_ADD)
  @ApiOperation({ summary: 'Add a recruitment candidate' })
  @ApiCreatedResponse({ type: CreateRushCandidateResponseDto })
  @FeatureEvent(
    'rush-candidate-added',
    ({
      body,
      result,
    }: FeatureEventInput<
      CreateRushCandidateDto,
      CreateRushCandidateResponseDto
    >) => ({
      is_existing_user: !!body.user_id,
      // `card_posted` is absent when no card was due and false when it failed.
      posted_to_chat: result.card_posted === true,
    }),
  )
  async create(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') createdBy: string,
    @Body() dto: CreateRushCandidateDto,
  ) {
    return this.rushService.create({
      chapter_id: chapterId,
      display_name: dto.display_name,
      created_by: createdBy,
      user_id: dto.user_id,
      channel_id: dto.channel_id,
      client_message_id: dto.client_message_id,
    });
  }

  @Post(':id/vote')
  @RequirePermissions(SystemPermissions.RUSH_VOTE)
  @ApiOperation({
    summary:
      'Cast a vote on a candidate (idempotent; a repeat vote returns 201 again, not a conflict)',
  })
  @ApiCreatedResponse({ type: RushCandidateViewDto })
  @FeatureEvent('rush-candidate-voted')
  async vote(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rushService.vote(id, chapterId, userId);
  }

  @Post(':id/bid')
  @RequirePermissions(SystemPermissions.RUSH_BID)
  @ApiOperation({
    summary:
      'Extend a bid (idempotent; a repeat bid returns 201 again, not a conflict)',
  })
  @ApiCreatedResponse({ type: RushCandidateViewDto })
  @FeatureEvent('rush-candidate-bid')
  async bid(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rushService.bid(id, chapterId, userId);
  }
}
