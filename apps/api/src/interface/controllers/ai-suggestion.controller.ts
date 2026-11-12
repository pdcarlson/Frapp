import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  AiSuggestionService,
  type AiSuggestionEdits,
} from '../../application/services/ai-suggestion.service';
import { AiEnabledGuard } from '../guards/ai-enabled.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import {
  CurrentChapterId,
  CurrentEnabledModules,
  CurrentUser,
} from '../decorators/current-user.decorator';
import {
  AcceptAiSuggestionDto,
  AiSuggestionDecideResponseDto,
  AiSuggestionDecideOutcomeDto,
  AiSuggestionDecisionDto,
  AiSuggestionDto,
  AiSuggestionListDto,
  DecideAiSuggestionsDto,
  ListAiSuggestionsQueryDto,
} from '../dtos/ai-suggestion.dto';

/**
 * The changes sent with an accept, for the kind they are for. The service
 * refuses changes for a kind other than the suggestion's.
 */
function editsOf(dto: AcceptAiSuggestionDto): AiSuggestionEdits | undefined {
  if (dto.task) return { kind: 'task', fields: { ...dto.task } };
  if (dto.points) return { kind: 'points', fields: { ...dto.points } };
  return undefined;
}

/**
 * AI suggestions (#4309, spec/behavior/ai.md § Suggestions): the officer's
 * Suggested list, and accept, edit-then-accept and dismiss.
 *
 * Every member reaches the routes; what each one sees and may decide is
 * narrowed in the service to the suggestions they could accept now (the
 * kind's permission, its module on, its source open to them). Off, with 404
 * `ai.not_available`, unless the server's `AI_ENABLED` is on.
 */
@ApiTags('AI suggestions')
@ApiBearerAuth()
@UseGuards(AiEnabledGuard, SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@Controller('ai/suggestions')
export class AiSuggestionController {
  constructor(private readonly suggestions: AiSuggestionService) {}

  @Get()
  @ApiOperation({
    summary:
      'The Suggested list: waiting suggestions the caller could accept, newest first',
  })
  @ApiOkResponse({ type: AiSuggestionListDto })
  async list(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
    @Query() query: ListAiSuggestionsQueryDto,
  ): Promise<AiSuggestionListDto> {
    if (!query.source_type !== !query.source_id) {
      throw new BadRequestException(
        'Send source_type and source_id together, or neither.',
      );
    }
    const { items, has_more } = await this.suggestions.listForUser(
      chapterId,
      userId,
      {
        source:
          query.source_type && query.source_id
            ? { type: query.source_type, id: query.source_id }
            : undefined,
        enabledModules,
      },
    );
    return { items: items.map((row) => AiSuggestionDto.from(row)), has_more };
  }

  @Post(':id/accept')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Accept a suggestion, with changes when given. Re-checks the caller now, then makes the change as them.',
  })
  @ApiOkResponse({ type: AiSuggestionDecisionDto })
  async accept(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptAiSuggestionDto,
  ): Promise<AiSuggestionDecisionDto> {
    return AiSuggestionDecisionDto.from(
      await this.suggestions.accept(chapterId, userId, id, {
        edits: editsOf(dto),
        enabledModules,
      }),
    );
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  @ApiOperation({ summary: 'Dismiss a suggestion' })
  @ApiOkResponse({ type: AiSuggestionDecisionDto })
  async dismiss(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AiSuggestionDecisionDto> {
    return AiSuggestionDecisionDto.from(
      await this.suggestions.dismiss(chapterId, userId, id),
    );
  }

  @Post('decide')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Accept or dismiss several suggestions at once (a review screen’s Confirm). Each one is decided on its own and has its own outcome.',
  })
  @ApiOkResponse({ type: AiSuggestionDecideResponseDto })
  async decide(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
    @Body() dto: DecideAiSuggestionsDto,
  ): Promise<AiSuggestionDecideResponseDto> {
    const outcomes = await this.suggestions.decideMany(
      chapterId,
      userId,
      dto.items.map((item) =>
        item.action === 'accept'
          ? { id: item.id, action: 'accept', edits: editsOf(item) }
          : { id: item.id, action: 'dismiss' },
      ),
      enabledModules,
    );
    return {
      outcomes: outcomes.map((outcome) =>
        AiSuggestionDecideOutcomeDto.from(outcome),
      ),
    };
  }
}
