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

@ApiTags('Rush')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@RequireModule('rush')
@Controller('rush/candidates')
export class RushController {
  constructor(private readonly rushService: RushService) {}

  @Get()
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
  @ApiOperation({ summary: 'Add a recruitment candidate' })
  @ApiCreatedResponse({ type: CreateRushCandidateResponseDto })
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
  @ApiOperation({
    summary: 'Cast a vote on a candidate (idempotent; already-voted is 200)',
  })
  @ApiOkResponse({ type: RushCandidateViewDto })
  async vote(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rushService.vote(id, chapterId, userId);
  }

  @Post(':id/bid')
  @ApiOperation({
    summary: 'Extend a bid (idempotent; already-extended is 200)',
  })
  @ApiOkResponse({ type: RushCandidateViewDto })
  async bid(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rushService.bid(id, chapterId, userId);
  }
}
