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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { MeetingNotesService } from '../../application/services/meeting-notes.service';
import { AiEnabledGuard } from '../guards/ai-enabled.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { RequireModule } from '../decorators/module.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import {
  AddMeetingNoteTakerDto,
  ListMeetingNoteTakingQueryDto,
  MeetingNoteTakingDto,
  MeetingNotesDto,
  SaveMeetingNotesDto,
} from '../dtos/meeting.dto';

/**
 * Several members take notes on one meeting (#4935, `spec/behavior/meetings.md`
 * § Several note-takers). Off, with 404 `ai.not_available`, unless the
 * server's `AI_ENABLED` is on: notes are what a draft is written from.
 *
 * No permission on the routes themselves, so no `PermissionsGuard`: a member
 * the minutes' author added may hold no meetings permission at all (the
 * route-access ledger lists each as membership-only). The service decides, and answers
 * anyone who may not take notes on these minutes with the 404 a missing id
 * gets.
 */
@ApiTags('Meetings')
@ApiBearerAuth()
@UseGuards(AiEnabledGuard, SupabaseAuthGuard, ChapterGuard)
@RequireModule('meetings')
@Controller()
export class MeetingNotesController {
  constructor(private readonly notes: MeetingNotesService) {}

  @Get('meeting-notes')
  @ApiOperation({
    summary:
      'Unposted minutes the caller may take notes on and doesn’t edit: an officer’s to join, or ones they were added to',
  })
  @ApiOkResponse({ type: [MeetingNoteTakingDto] })
  async list(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query() query: ListMeetingNoteTakingQueryDto,
  ): Promise<MeetingNoteTakingDto[]> {
    return this.notes.listForUser(chapterId, userId, query.event_id);
  }

  @Get('meetings/:id/notes')
  @ApiOperation({
    summary:
      'The caller’s own notes on these minutes and who else takes notes; the author and editors read everyone’s',
  })
  @ApiOkResponse({ type: MeetingNotesDto })
  async get(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MeetingNotesDto> {
    return this.notes.state(chapterId, id, userId);
  }

  @Put('meetings/:id/notes')
  @ApiOperation({
    summary:
      'Save the caller’s own notes, joining as a note-taker if they weren’t. Empty notes clear them, with any draft written from them. 409 `meeting.draft_posted`, 400 `meeting.standards_refused`',
  })
  @ApiOkResponse({ type: MeetingNotesDto })
  async save(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveMeetingNotesDto,
  ): Promise<MeetingNotesDto> {
    return this.notes.save(chapterId, id, userId, dto.notes);
  }

  @Post('meetings/:id/note-takers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Add a member the meeting’s event invites as a note-taker, for the author or an editor. They are told once. 400 `meeting.not_in_audience`',
  })
  @ApiOkResponse({ type: MeetingNotesDto })
  async add(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMeetingNoteTakerDto,
  ): Promise<MeetingNotesDto> {
    return this.notes.add(chapterId, id, userId, dto.user_id);
  }

  @Delete('meetings/:id/note-takers/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Remove a note-taker with their notes and any draft written from them: the author or an editor removes anyone, a note-taker themselves',
  })
  @ApiNoContentResponse()
  async remove(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) targetId: string,
  ): Promise<void> {
    await this.notes.remove(chapterId, id, userId, targetId);
  }
}
