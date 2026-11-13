import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ASK_STREAM_CONTENT_TYPE,
  ASK_STREAM_KEEPALIVE,
  ASK_STREAM_VERSION,
  FALLBACK_TIME_ZONE,
  encodeAskStreamEvent,
  isSupportedTimeZone,
} from '@repo/validation';
import { LanguageModelError } from '#domain/adapters/language-model.interface';
import { SystemPermissions } from '#domain/constants/permissions';
import { TIME_ZONE_HEADER } from '#domain/constants/time-zone-header';
import { AskDiagnosticsService } from '../../application/services/ask/ask-diagnostics.service';
import { AskConversationService } from '../../application/services/ask/ask-conversation.service';
import { AskSuggestionsService } from '../../application/services/ask/ask-suggestions.service';
import { AskService } from '../../application/services/ask/ask.service';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import {
  CurrentChapterId,
  CurrentEnabledModules,
  CurrentMember,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { ThrottleFanOutWrite } from '../decorators/throttle-profiles.decorator';
import { ActResponseDto } from '../dtos/act.dto';
import {
  AskDiagnosticsDto,
  AskRequestDto,
  AskStatusDto,
  AskSuggestionsDto,
} from '../dtos/ask.dto';
import { AiEnabledGuard } from '../guards/ai-enabled.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import type { MemberContext } from '../types/request-context.types';

const AI_OFF = {
  description: 'AI is off on this server (`ai.not_available`).',
};
const KEEPALIVE_MS = 15_000;

/**
 * Ask Frapp (#450, `spec/behavior/ai.md`): a member's question, answered
 * from their chapter's sources, streamed. For a client that shows proposal
 * cards (`actions`), words that ask for something to be done end in a card
 * to confirm instead (`AskConversationService`); the route still changes
 * nothing.
 *
 * `AiEnabledGuard` first, so a server with `AI_ENABLED` off answers 404
 * `ai.not_available` on every route here. Then the member, their chapter and
 * `ai:use`. The chapter's Ask switch and the member's answer on the AI sheet
 * are checked before the stream opens and again by the gateway before every
 * model call.
 */
@ApiTags('AI')
@ApiBearerAuth()
@UseGuards(AiEnabledGuard, SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.AI_USE)
@Controller('ai/ask')
export class AskController {
  private readonly logger = new Logger(AskController.name);

  constructor(
    private readonly askService: AskService,
    private readonly conversation: AskConversationService,
    private readonly diagnostics: AskDiagnosticsService,
    private readonly suggestions: AskSuggestionsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'What Ask needs to know before the first question',
    description:
      'Whether questions and answers are being kept by the beta diagnostics window, which a client must show before it sends a question.',
  })
  @ApiOkResponse({ type: AskStatusDto })
  @ApiNotFoundResponse(AI_OFF)
  async status(
    @CurrentChapterId() chapterId: string,
    @CurrentMember() member: MemberContext,
  ): Promise<AskStatusDto> {
    const diagnostics = await this.diagnostics.view(
      chapterId,
      member.role_ids,
      new Date(),
    );
    return { saved_until: diagnostics.ends_at, diagnostics };
  }

  @Get('suggestions')
  @ApiOperation({
    summary: 'What Ask opens with for this member',
    description:
      'Up to three questions and one request, each built from a record the caller’s own account holds right now (their next event, their open tasks, what they owe, minutes they can read, their points). No model is called, and the chapter’s Ask switch and the AI sheet are not checked: nothing here leaves the server. Each question is one Ask could answer for this caller. Empty when there is nothing to ask about.',
  })
  @ApiOkResponse({ type: AskSuggestionsDto })
  @ApiNotFoundResponse(AI_OFF)
  async openingSuggestions(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
    @Headers(TIME_ZONE_HEADER) timeZoneHeader: string | undefined,
  ): Promise<AskSuggestionsDto> {
    return {
      suggestions: await this.suggestions.suggest({
        chapterId,
        userId,
        enabledModules,
        timeZone: isSupportedTimeZone(timeZoneHeader)
          ? timeZoneHeader
          : FALLBACK_TIME_ZONE,
      }),
    };
  }

  @Post()
  @HttpCode(200)
  @ThrottleFanOutWrite()
  @ApiOperation({
    summary: 'Ask a question; the answer is streamed',
    description: `The response is Server-Sent Events. Each \`data:\` line is one JSON event of the Ask stream format, version ${ASK_STREAM_VERSION}, defined in \`@repo/validation\` (\`AskStreamEventSchema\`): \`start\`, \`status\`, \`text\` deltas, then one \`done\` carrying the checked answer with its citations and sources, or \`error\`. Text deltas are a preview; the answer is what \`done\` carries. A request sent with \`actions\` can end with one \`proposal\` instead of \`done\`, carrying the answer \`POST /v1/ai/act\` gives. Refusals that need the client to act arrive before the stream, as ordinary errors.`,
  })
  @ApiProduces(ASK_STREAM_CONTENT_TYPE)
  @ApiOkResponse({
    description: 'The event stream.',
    content: { [ASK_STREAM_CONTENT_TYPE]: { schema: { type: 'string' } } },
  })
  @ApiForbiddenResponse({
    description:
      'The caller has not said yes on the AI sheet (`ai.consent.required`), or the president has Ask turned off (`ai.chapter_off`).',
  })
  @ApiNotFoundResponse(AI_OFF)
  async ask(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
    @Headers(TIME_ZONE_HEADER) timeZoneHeader: string | undefined,
    @Body() dto: AskRequestDto,
    @Res() response: Response,
  ): Promise<void> {
    // Before any header is sent, so these arrive as ordinary errors.
    await this.askService.assertMayAsk(chapterId, userId);

    const abort = new AbortController();
    // `close` also fires after a normal end; aborting then does nothing.
    response.on('close', () => abort.abort());
    // A member who left while the guards and the consent read ran: `close`
    // has already fired and will not fire again, so nothing would stop the
    // work or its spend.
    if (response.destroyed) return;
    response.status(200).set({
      'Content-Type': `${ASK_STREAM_CONTENT_TYPE}; charset=utf-8`,
      'Cache-Control': 'no-cache, no-transform',
      // Tells a buffering proxy to pass each event through as it is written.
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    const keepalive = setInterval(() => {
      response.write(ASK_STREAM_KEEPALIVE);
    }, KEEPALIVE_MS);

    try {
      for await (const event of this.conversation.converse({
        chapterId,
        userId,
        question: dto.question,
        ...(dto.history === undefined ? {} : { history: dto.history }),
        actions: dto.actions === true,
        enabledModules,
        timeZone: isSupportedTimeZone(timeZoneHeader)
          ? timeZoneHeader
          : FALLBACK_TIME_ZONE,
        savedNoticeShown: dto.saved_notice_shown === true,
        signal: abort.signal,
      })) {
        if (abort.signal.aborted) break;
        response.write(
          encodeAskStreamEvent(
            event.type === 'act'
              ? {
                  v: ASK_STREAM_VERSION,
                  type: 'proposal',
                  // The same answer `POST /v1/ai/act` gives, so a card is
                  // one shape wherever it came from.
                  act: { ...ActResponseDto.from(event.outcome) },
                }
              : event,
          ),
        );
      }
    } catch (error) {
      // The member closed the panel or went offline: nobody to tell.
      if (!abort.signal.aborted) {
        const retryable =
          error instanceof LanguageModelError ? error.retryable : true;
        reportCaughtFailure(this.logger, {
          level: 'error',
          site: 'ask-stream',
          message: 'Ask: the answer failed after the stream began',
          // A `LanguageModelError` carries no provider text; anything else
          // here is a database or programming error, which carries none of
          // the question or the answer either.
          error,
        });
        response.write(
          encodeAskStreamEvent({
            v: ASK_STREAM_VERSION,
            type: 'error',
            code: 'ai.ask.failed',
            retryable,
          }),
        );
      }
    } finally {
      clearInterval(keepalive);
      response.end();
    }
  }

  @Post('diagnostics')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Turn on the beta diagnostics window (president only)',
    description:
      'The president’s yes: for 14 days from now, questions asked in Ask and their answers are kept, encrypted, for the Frapp team. Offered to one chapter only. The end date is fixed; the window turns itself off and deletes what it kept. Recorded in the audit log.',
  })
  @ApiOkResponse({ type: AskDiagnosticsDto })
  @ApiForbiddenResponse({
    description:
      'The caller is not the chapter’s president (`ai.ask.diagnostics.president_only`).',
  })
  @ApiConflictResponse({
    description: 'A window is already on (`ai.ask.diagnostics.already_on`).',
  })
  @ApiNotFoundResponse({
    description:
      'AI is off (`ai.not_available`), or the window is not offered to this chapter (`ai.ask.diagnostics.not_offered`).',
  })
  startDiagnostics(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentMember() member: MemberContext,
  ): Promise<AskDiagnosticsDto> {
    return this.diagnostics.start(
      chapterId,
      { userId, roleIds: member.role_ids },
      new Date(),
    );
  }
}

/**
 * Turning the Ask diagnostics window off (#4315). Its own controller, without
 * `AiEnabledGuard`, so a president can end a window and delete what it kept
 * even after `AI_ENABLED` goes off (#4504); otherwise only the 14-day sweep,
 * which runs either way, would end it. Nor does it need `ai:use`: the service
 * lets only the chapter's president stop a window, and it starts nothing.
 */
@ApiTags('AI')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard)
@Controller('ai/ask')
export class AskDiagnosticsStopController {
  constructor(private readonly diagnostics: AskDiagnosticsService) {}

  @Delete('diagnostics')
  @ApiOperation({
    summary: 'Turn off the beta diagnostics window (president only)',
    description:
      'Ends the window now and deletes everything it kept. Recorded in the audit log.',
  })
  @ApiOkResponse({ type: AskDiagnosticsDto })
  @ApiForbiddenResponse({
    description:
      'The caller is not the chapter’s president (`ai.ask.diagnostics.president_only`).',
  })
  @ApiNotFoundResponse({
    description:
      'No window is open and none is offered to this chapter (`ai.ask.diagnostics.not_offered`). Answers the same whether or not AI is on.',
  })
  stopDiagnostics(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentMember() member: MemberContext,
  ): Promise<AskDiagnosticsDto> {
    return this.diagnostics.stop(chapterId, {
      userId,
      roleIds: member.role_ids,
    });
  }
}
