import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { MeetingNoMinutesService } from '../../application/services/meeting-no-minutes.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import { RequireModule } from '../decorators/module.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { MeetingNoMinutesListDto } from '../dtos/meeting-no-minutes.dto';

/**
 * Meetings marked "No minutes" (`spec/behavior/meetings.md` § Meetings,
 * tied to their events): read and set by whoever can start minutes.
 */
@ApiTags('Meetings')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEETINGS_RECORD)
@RequireModule('meetings')
@Controller()
export class MeetingNoMinutesController {
  constructor(private readonly noMinutes: MeetingNoMinutesService) {}

  @Get('meetings-no-minutes')
  @ApiOperation({
    summary:
      'The events this officer can see that are marked "No minutes", so the Meetings list stops asking for them',
  })
  @ApiOkResponse({ type: MeetingNoMinutesListDto })
  async list(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<MeetingNoMinutesListDto> {
    return { event_ids: await this.noMinutes.list(chapterId, userId) };
  }

  @Put('events/:id/no-minutes')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Mark a meeting that ended as having no minutes. Marking it again changes nothing. 409 `meeting.not_over`, 409 `meeting.already_started`',
  })
  @ApiNoContentResponse()
  async mark(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.noMinutes.mark(chapterId, userId, id);
  }

  @Delete('events/:id/no-minutes')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Take a meeting’s "No minutes" mark off, so it asks for minutes again',
  })
  @ApiNoContentResponse()
  async unmark(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.noMinutes.unmark(chapterId, userId, id);
  }
}
