import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { MeetingTaskSuggestionsService } from '../../application/services/meeting-task-suggestions.service';
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
import { MeetingActionItemTaskDto } from '../dtos/meeting-action-item-task.dto';

/**
 * The tasks posted minutes' action items became, for the minutes' checkboxes
 * (`spec/behavior/meetings.md` § Suggested tasks). It lives beside the
 * suggestions, which link an item to its task, rather than in the meetings
 * module, which the suggestions module already imports. The guards and the
 * read rule are the minutes' own.
 */
@ApiTags('Meetings')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@RequireModule('meetings')
@Controller('meetings')
export class MeetingActionItemTasksController {
  constructor(private readonly suggestions: MeetingTaskSuggestionsService) {}

  @Get(':id/action-item-tasks')
  @ApiOperation({
    summary:
      'Which action items of posted minutes became tasks, and whether each is done. Empty for a draft',
  })
  @ApiOkResponse({ type: MeetingActionItemTaskDto, isArray: true })
  async list(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MeetingActionItemTaskDto[]> {
    return this.suggestions.actionItemTasks(chapterId, id, userId);
  }
}
