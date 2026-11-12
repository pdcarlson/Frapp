import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
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
import {
  MeetingService,
  type MeetingView,
} from '../../application/services/meeting.service';
import type { Meeting } from '#domain/entities/meeting.entity';
import { SystemPermissions } from '#domain/constants/permissions';
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
  ListMeetingsQueryDto,
  MeetingDto,
  MeetingSummaryDto,
  MeetingTemplateDto,
  PostMeetingDto,
  StartMeetingDto,
  UpdateMeetingDto,
} from '../dtos/meeting.dto';

function summaryOf(meeting: Meeting): MeetingSummaryDto {
  return {
    id: meeting.id,
    event_id: meeting.event_id,
    event_name: meeting.event_name,
    event_start_time: meeting.event_start_time,
    meeting_type: meeting.meeting_type,
    other_label: meeting.other_label,
    status: meeting.status,
    created_by: meeting.created_by,
    posted_at: meeting.posted_at,
    updated_at: meeting.updated_at,
  };
}

function dtoOf(view: MeetingView): MeetingDto {
  return {
    ...summaryOf(view.meeting),
    event_end_time: view.event_end_time,
    content: view.content,
    sections: view.sections,
    attendees: view.attendees,
    updated_by: view.meeting.updated_by,
    posted_by: view.meeting.posted_by,
    created_at: view.meeting.created_at,
    can_edit: view.can_edit,
    can_delete: view.can_delete,
  };
}

/**
 * Meeting minutes written by hand (`spec/behavior/meetings.md`, #4312). No
 * route here calls a model. Who may read and change which minutes is the
 * service's rule; the guards only say who may reach the routes at all.
 */
@ApiTags('Meetings')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@RequireModule('meetings')
@Controller('meetings')
export class MeetingController {
  constructor(private readonly meetings: MeetingService) {}

  @Get()
  @ApiOperation({
    summary:
      'Minutes the caller may read, newest meeting first: posted ones whose event invites them, and their own drafts',
  })
  @ApiOkResponse({ type: MeetingSummaryDto, isArray: true })
  async list(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query() query: ListMeetingsQueryDto,
  ): Promise<MeetingSummaryDto[]> {
    const rows = await this.meetings.list(chapterId, userId, query.event_id);
    return rows.map(summaryOf);
  }

  @Get('template')
  @ApiOperation({ summary: 'The sections the chapter’s minutes show' })
  @ApiOkResponse({ type: MeetingTemplateDto })
  async getTemplate(
    @CurrentChapterId() chapterId: string,
  ): Promise<MeetingTemplateDto> {
    return { sections: await this.meetings.getTemplate(chapterId) };
  }

  @Put('template')
  @RequirePermissions(SystemPermissions.CHAPTER_CONFIG_MANAGE)
  @ApiOperation({ summary: 'Choose the sections the chapter’s minutes show' })
  @ApiOkResponse({ type: MeetingTemplateDto })
  async setTemplate(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: MeetingTemplateDto,
  ): Promise<MeetingTemplateDto> {
    return {
      sections: await this.meetings.setTemplate(
        chapterId,
        userId,
        dto.sections,
      ),
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'One meeting’s minutes' })
  @ApiOkResponse({ type: MeetingDto })
  async getOne(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MeetingDto> {
    return dtoOf(await this.meetings.get(chapterId, id, userId));
  }

  @Post()
  @RequirePermissions(SystemPermissions.MEETINGS_RECORD)
  @ApiOperation({
    summary:
      'Start minutes for a meeting’s event, or for a meeting with none (new_event). 409 `meeting.already_started` names the minutes that exist',
  })
  @ApiCreatedResponse({ type: MeetingDto })
  async start(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: StartMeetingDto,
  ): Promise<MeetingDto> {
    return dtoOf(await this.meetings.start(chapterId, userId, dto));
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Save minutes: their author, or someone who can edit any minutes. 409 `meeting.stale` when someone saved since',
  })
  @ApiOkResponse({ type: MeetingDto })
  async update(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMeetingDto,
  ): Promise<MeetingDto> {
    return dtoOf(await this.meetings.update(chapterId, id, userId, dto));
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Post minutes to the members their event invites, who are each told once',
  })
  @ApiOkResponse({ type: MeetingDto })
  async post(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostMeetingDto,
  ): Promise<MeetingDto> {
    return dtoOf(
      await this.meetings.post(chapterId, id, userId, dto.expected_updated_at),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Delete minutes: someone who can delete minutes, or the author of an unposted draft',
  })
  @ApiNoContentResponse()
  async delete(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.meetings.delete(chapterId, id, userId);
  }
}
