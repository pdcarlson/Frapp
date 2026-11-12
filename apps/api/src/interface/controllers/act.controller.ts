import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FALLBACK_TIME_ZONE, isSupportedTimeZone } from '@repo/validation';
import { SystemPermissions } from '#domain/constants/permissions';
import { TIME_ZONE_HEADER } from '#domain/constants/time-zone-header';
import { ActService } from '../../application/services/act/act.service';
import {
  CurrentChapterId,
  CurrentEnabledModules,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { ThrottleFanOutWrite } from '../decorators/throttle-profiles.decorator';
import {
  ActEventAudienceDto,
  ActRequestDto,
  ActResponseDto,
  ActStatusDto,
} from '../dtos/act.dto';
import { AiEnabledGuard } from '../guards/ai-enabled.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';

const AI_OFF = {
  description: 'AI is off on this server (`ai.not_available`).',
};
const NOT_ALLOWED = {
  description:
    'The caller does not hold `ai:use` and `ai:act`, has not said yes on the AI sheet (`ai.consent.required`), or the president has Ask turned off (`ai.chapter_off`).',
};

function zone(header: string | undefined): string {
  return isSupportedTimeZone(header) ? header : FALLBACK_TIME_ZONE;
}

/**
 * Asking Frapp to do something (#718, `spec/behavior/ai.md` § Asking Frapp to
 * do something). Its own routes, apart from Ask's: a question (`/v1/ai/ask`)
 * has no way to reach an action, and a request here never answers a question
 * (`docs/security/ai-prompt-injection.md` C5).
 *
 * **No route here changes anything in the chapter.** Each answers with a
 * proposal, saved as a suggestion only the caller can open. The change is
 * made by `POST /v1/ai/suggestions/{id}/accept`, which checks the action's
 * own permission again.
 *
 * `AiEnabledGuard` first, so a server with `AI_ENABLED` off answers 404
 * `ai.not_available`. Then the member, their chapter, and both `ai:use` and
 * `ai:act`, with `members:view` as on every route this mirrors (a card
 * names members, and Confirm needs it). No seeded role holds `ai:act`: a
 * chapter grants it from the Roles page.
 */
@ApiTags('AI')
@ApiBearerAuth()
@UseGuards(AiEnabledGuard, SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(
  SystemPermissions.MEMBERS_VIEW,
  SystemPermissions.AI_USE,
  SystemPermissions.AI_ACT,
)
@Controller('ai/act')
export class ActController {
  constructor(private readonly actService: ActService) {}

  @Get()
  @ApiOperation({
    summary: 'The actions the caller can ask for',
    description:
      'The actions whose own route the caller could call now (its permission held, its module on). A client shows the Do side of Ask only when this answers, and offers an example for each action listed.',
  })
  @ApiOkResponse({ type: ActStatusDto })
  @ApiForbiddenResponse(NOT_ALLOWED)
  @ApiNotFoundResponse(AI_OFF)
  async status(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
  ): Promise<ActStatusDto> {
    return {
      actions: await this.actService.availableActions({
        chapterId,
        userId,
        enabledModules,
        timeZone: FALLBACK_TIME_ZONE,
      }),
    };
  }

  @Post()
  @HttpCode(200)
  @ThrottleFanOutWrite()
  @ApiOperation({
    summary: 'Ask for something to be done; the answer is a proposal',
    description:
      'Reads the request into one action and its details and answers with a proposal to confirm. Nothing is changed. Only the request text is shown to a model when the action is chosen. A new request replaces the caller’s earlier unconfirmed proposal.',
  })
  @ApiOkResponse({ type: ActResponseDto })
  @ApiForbiddenResponse(NOT_ALLOWED)
  @ApiNotFoundResponse(AI_OFF)
  async act(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
    @Headers(TIME_ZONE_HEADER) timeZoneHeader: string | undefined,
    @Body() dto: ActRequestDto,
  ): Promise<ActResponseDto> {
    await this.actService.assertMayAct(chapterId, userId);
    return ActResponseDto.from(
      await this.actService.act({
        chapterId,
        userId,
        enabledModules,
        timeZone: zone(timeZoneHeader),
        request: dto.request,
      }),
    );
  }

  @Post('event-audience')
  @HttpCode(200)
  @ThrottleFanOutWrite()
  @ApiOperation({
    summary: 'Pick the event whose attendees a points proposal is for',
    description:
      'The follow-up to a `needs_event` answer. No model is called. Answers with the proposal, or 404 when the event is not one the caller can see in this chapter.',
  })
  @ApiOkResponse({ type: ActResponseDto })
  @ApiForbiddenResponse(NOT_ALLOWED)
  @ApiNotFoundResponse({
    description:
      'AI is off (`ai.not_available`), or the event was not found for this caller.',
  })
  async eventAudience(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
    @Headers(TIME_ZONE_HEADER) timeZoneHeader: string | undefined,
    @Body() dto: ActEventAudienceDto,
  ): Promise<ActResponseDto> {
    await this.actService.assertMayAct(chapterId, userId);
    return ActResponseDto.from(
      await this.actService.proposePointsForEvent({
        chapterId,
        userId,
        enabledModules,
        timeZone: zone(timeZoneHeader),
        eventId: dto.event_id,
        amount: dto.amount,
        reason: dto.reason ?? null,
      }),
    );
  }
}
