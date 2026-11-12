import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { MeetingDraftService } from '../../application/services/meeting-draft.service';
import { SystemPermissions } from '#domain/constants/permissions';
import { AiEnabledGuard } from '../guards/ai-enabled.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { RequireModule } from '../decorators/module.decorator';
import { FeatureEvent } from '../decorators/feature-event.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import {
  MeetingDraftDto,
  RequestMeetingDraftDto,
  UseMeetingDraftDto,
} from '../dtos/meeting.dto';

/**
 * Minutes drafted from an officer's notes (`spec/behavior/meetings.md`
 * § Drafting from notes, #4312). Off, with 404 `ai.not_available`, unless the
 * server's `AI_ENABLED` is on; a client reads that as "no drafting here" and
 * shows the hand-written flow alone.
 *
 * Only someone who may edit the minutes reaches a draft, by the service's
 * rule; anyone else gets the 404 a missing id does.
 */
@ApiTags('Meetings')
@ApiBearerAuth()
@UseGuards(AiEnabledGuard, SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
// Drafting is part of starting minutes (`meetings.md` § Permissions), so the
// whole surface asks for `meetings:record`: someone who may only edit minutes
// is never shown a notes box they can't use.
@RequirePermissions(SystemPermissions.MEETINGS_RECORD)
@RequireModule('meetings')
@Controller('meetings/:id/draft')
export class MeetingDraftController {
  constructor(private readonly drafts: MeetingDraftService) {}

  @Get()
  @ApiOperation({
    summary:
      'Where the draft from notes stands: none, drafting, ready, applied or failed, with the notes and what to check the draft against',
  })
  @ApiOkResponse({ type: MeetingDraftDto })
  async get(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MeetingDraftDto> {
    return this.drafts.state(chapterId, id, userId);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Draft the minutes from notes, as a background AI run. Replaces an earlier request. 400 `meeting.standards_refused`, 403 `ai.chapter_off` or `ai.consent.required`, 409 `meeting.stale` or `meeting.draft_posted`, each before any text is stored or sent',
  })
  @ApiAcceptedResponse({ type: MeetingDraftDto })
  @FeatureEvent('meeting-draft-requested')
  async request(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestMeetingDraftDto,
  ): Promise<MeetingDraftDto> {
    return this.drafts.request(chapterId, id, userId, dto);
  }

  @Post('use')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Put a draft that waited (`ready`) into the minutes at the version the editor has. 409 `meeting.stale` when they moved again, 409 `meeting.draft_not_waiting` when no draft waits',
  })
  @ApiOkResponse({ type: MeetingDraftDto })
  async use(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UseMeetingDraftDto,
  ): Promise<MeetingDraftDto> {
    return this.drafts.use(chapterId, id, userId, dto.expected_updated_at);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Clear the notes and the draft, and stop a draft still being written. With `keep_notes=true`, only stop it: the notes stay and the request ends as `stopped`. The minutes themselves are not changed',
  })
  @ApiQuery({ name: 'keep_notes', required: false, type: Boolean })
  @ApiNoContentResponse()
  async discard(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('keep_notes') keepNotes?: string,
  ): Promise<void> {
    await this.drafts.discard(chapterId, id, userId, {
      keepNotes: keepNotes === 'true',
    });
  }
}
