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
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiQuery,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { MeetingRecordingService } from '../../application/services/meeting-recording.service';
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
  ConfirmMeetingRecordingDto,
  MeetingRecordingDto,
  StartMeetingRecordingDto,
} from '../dtos/meeting.dto';

/**
 * A meeting's uploaded recording, written out as text
 * (`spec/behavior/meetings.md` § Uploading a recording, #712). Off, with 404
 * `ai.not_available`, unless the server's `AI_ENABLED` is on.
 *
 * The file itself never passes through this API: the browser sends it to
 * storage with the signature `POST` returns, then says it is there. Only
 * someone who may edit the minutes reaches a recording, by the service's
 * rule; anyone else gets the 404 a missing id does.
 */
@ApiTags('Meetings')
@ApiBearerAuth()
@UseGuards(AiEnabledGuard, SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEETINGS_RECORD)
@RequireModule('meetings')
@Controller('meetings/:id/recording')
export class MeetingRecordingController {
  constructor(private readonly recordings: MeetingRecordingService) {}

  @Get()
  @ApiOperation({
    summary:
      'Where the recording stands: none, uploading, transcribing, ready (with the transcript) or failed, and what this server takes',
  })
  @ApiOkResponse({ type: MeetingRecordingDto })
  async get(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MeetingRecordingDto> {
    return this.recordings.state(chapterId, id, userId);
  }

  @Post()
  @ApiOperation({
    summary:
      'Start an upload: checks the file and signs a resumable upload to private storage. Replaces an earlier recording. 400 `meeting.standards_refused`, `meeting.recording_notice_required`, `meeting.recording_format`, `meeting.recording_too_large`, `meeting.recording_too_short` or `meeting.recording_too_long`; 403 `ai.chapter_off` or `ai.consent.required`; 409 `meeting.draft_posted` or `meeting.recording_unavailable`, each before anything is stored',
  })
  @ApiCreatedResponse({ type: MeetingRecordingDto })
  async start(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartMeetingRecordingDto,
  ): Promise<MeetingRecordingDto> {
    return this.recordings.start(chapterId, id, userId, dto);
  }

  @Post('uploaded')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'The file is in storage: transcribe it, as a background AI run, and tell the members who were at the meeting. Safe to call twice. 409 `meeting.recording_incomplete` when the file is not there, 409 `meeting.recording_replaced` when the upload was replaced or removed',
  })
  @ApiAcceptedResponse({ type: MeetingRecordingDto })
  @FeatureEvent('meeting-recording-uploaded')
  async uploaded(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmMeetingRecordingDto,
  ): Promise<MeetingRecordingDto> {
    return this.recordings.uploaded(chapterId, id, userId, dto.upload_id);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      "Remove the recording, its transcript and its audio, and stop a transcription still running. The notes and the minutes are not changed. With `upload_id`, only when that upload is still the meeting's recording: what a page giving up on its own upload sends",
  })
  @ApiQuery({ name: 'upload_id', required: false, format: 'uuid' })
  @ApiNoContentResponse()
  async remove(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('upload_id', new ParseUUIDPipe({ optional: true }))
    uploadId?: string,
  ): Promise<void> {
    await this.recordings.remove(chapterId, id, userId, uploadId);
  }
}
