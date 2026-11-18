import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AgendaSuggestionService } from '../../application/services/agenda-suggestion.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { RequireModule } from '../decorators/module.decorator';
import {
  ThrottleExpensiveWrite,
  ThrottleFanOutWrite,
} from '../decorators/throttle-profiles.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import {
  AddAgendaSuggestionResponseDto,
  AgendaSuggestionListDto,
} from '../dtos/agenda-suggestion.dto';
import { SystemPermissions } from '#domain/constants/permissions';

/**
 * Suggested agenda items (#5534, `spec/behavior/events.md` § Suggested
 * agenda items): for whoever may edit the event, as the agenda itself is.
 */
@ApiTags('Events')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.EVENTS_UPDATE)
@RequireModule('events')
@Controller('events/:id/agenda-suggestions')
export class AgendaSuggestionController {
  constructor(private readonly suggestions: AgendaSuggestionService) {}

  @Get()
  @ApiOperation({
    summary:
      'List an upcoming event’s suggested agenda items, tabled matters first',
  })
  @ApiOkResponse({ type: AgendaSuggestionListDto })
  list(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) eventId: string,
  ): Promise<AgendaSuggestionListDto> {
    return this.suggestions.list(chapterId, eventId, userId);
  }

  @Post('refresh')
  @HttpCode(200)
  @ThrottleExpensiveWrite()
  @ApiOperation({
    summary:
      'Ask the model for this event’s suggestions again, replacing its open ones',
  })
  @ApiOkResponse({ type: AgendaSuggestionListDto })
  refresh(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) eventId: string,
  ): Promise<AgendaSuggestionListDto> {
    return this.suggestions.refresh(chapterId, eventId, userId);
  }

  @Post(':suggestionId/add')
  @HttpCode(200)
  @ThrottleFanOutWrite()
  @ApiOperation({ summary: 'Add a suggestion to the end of the agenda' })
  @ApiOkResponse({ type: AddAgendaSuggestionResponseDto })
  add(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) eventId: string,
    @Param('suggestionId', ParseUUIDPipe) suggestionId: string,
  ): Promise<AddAgendaSuggestionResponseDto> {
    return this.suggestions.add(chapterId, eventId, suggestionId, userId);
  }

  @Post(':suggestionId/dismiss')
  @HttpCode(204)
  @ThrottleFanOutWrite()
  @ApiOperation({ summary: 'Hide a suggestion for this event' })
  @ApiNoContentResponse()
  async dismiss(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) eventId: string,
    @Param('suggestionId', ParseUUIDPipe) suggestionId: string,
  ): Promise<void> {
    await this.suggestions.dismiss(chapterId, eventId, suggestionId, userId);
  }
}
