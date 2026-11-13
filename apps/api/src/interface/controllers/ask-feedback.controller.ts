import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SystemPermissions } from '#domain/constants/permissions';
import { AskFeedbackService } from '../../application/services/ask/observe/ask-feedback.service';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { RequirePermissions } from '../decorators/permissions.decorator';
import {
  AskFeedbackDto,
  AskSignalDto,
  SetAskFeedbackDto,
} from '../dtos/ask-feedback.dto';
import { AiEnabledGuard } from '../guards/ai-enabled.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';

const NOT_FOUND = {
  description:
    'AI is off on this server (`ai.not_available`), or there is no answer with this id that the caller asked in this chapter (`ai.ask.feedback.not_found`). An ask that is someone else’s and one that does not exist answer the same.',
};

/**
 * The asker's thumbs on an Ask answer and the taps under it (#4902,
 * `spec/behavior/ai.md` § Feedback on an answer). No route here takes or
 * returns a word of a question or an answer, and none reads another
 * member's thumbs.
 *
 * `AiEnabledGuard` first, so a server with `AI_ENABLED` off answers 404
 * `ai.not_available`, as for every AI route. Then the member, their chapter
 * and `ai:use`, as for the ask itself.
 */
@ApiTags('AI')
@ApiBearerAuth()
@UseGuards(AiEnabledGuard, SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.AI_USE)
@Controller('ai/ask/:ask_id')
export class AskFeedbackController {
  constructor(private readonly feedback: AskFeedbackService) {}

  @Put('feedback')
  @ApiOperation({
    summary: 'Rate an answer: thumbs up or down',
    description:
      'Sets the caller’s thumbs on an answer they were given, replacing an earlier one. A `down` may carry one of four reasons. Nothing of the question or the answer is sent or kept: to send those, the member reports the answer (`POST /v1/ai/reports`). Kept with the answer’s trace, for at most 90 days.',
  })
  @ApiOkResponse({ type: AskFeedbackDto })
  @ApiBadRequestResponse({
    description:
      'A reason sent with a thumbs up (`ai.ask.feedback.reason_needs_down`).',
  })
  @ApiNotFoundResponse(NOT_FOUND)
  async rate(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('ask_id', ParseUUIDPipe) askId: string,
    @Body() dto: SetAskFeedbackDto,
  ): Promise<AskFeedbackDto> {
    return AskFeedbackDto.from(
      await this.feedback.rate(
        { chapterId, userId, askId },
        dto.rating,
        dto.reason ?? null,
      ),
    );
  }

  @Delete('feedback')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Take a thumbs back',
    description: 'Succeeds whether or not there was one.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse(NOT_FOUND)
  clear(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('ask_id', ParseUUIDPipe) askId: string,
  ): Promise<void> {
    return this.feedback.clear({ chapterId, userId, askId });
  }

  @Post('signals')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Say what the member did with an answer',
    description:
      'One tap under an answer the caller was given: Try again, Think harder, a source opened, a proposed card confirmed or dismissed. Counted as an analytics event; nothing is stored.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse(NOT_FOUND)
  signal(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('ask_id', ParseUUIDPipe) askId: string,
    @Body() dto: AskSignalDto,
  ): Promise<void> {
    return this.feedback.signal({ chapterId, userId, askId }, dto.signal);
  }
}
